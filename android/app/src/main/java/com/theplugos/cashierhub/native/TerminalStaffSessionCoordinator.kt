package com.theplugos.cashierhub.native

import org.json.JSONObject
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

data class TerminalCommandIntent(
    val commandId: String,
    val type: String,
    val issuedAt: String,
    val deviceId: String,
    val staffSessionId: String,
    val sequence: Long,
    val payloadBase64: String,
    val signature: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("commandId", commandId)
        .put("type", type)
        .put("issuedAt", issuedAt)
        .put("deviceId", deviceId)
        .put("staffSessionId", staffSessionId)
        .put("sequence", sequence)
        .put("payloadBase64", payloadBase64)
        .put("signature", signature)

    fun toStorageJson(): JSONObject = toJson()

    companion object {
        fun fromStorageJson(value: JSONObject): TerminalCommandIntent = TerminalCommandIntent(
            commandId = value.requiredUuid("commandId", "Terminal command ID"),
            type = value.requiredTerminalSessionText("type", "Terminal command type", 80),
            issuedAt = value.requiredTerminalSessionText("issuedAt", "Terminal command issue time", 24).also {
                HubTime.requireCanonicalUtc(it, "Terminal command issue time")
            },
            deviceId = value.requiredTerminalSessionDeviceId("deviceId", "Terminal command device ID"),
            staffSessionId = value.requiredUuid("staffSessionId", "Terminal command staff-session ID"),
            sequence = value.requiredNonNegativeSequence("sequence"),
            payloadBase64 = value.requiredTerminalSessionBase64("payloadBase64", "Terminal command payload", 2, 128 * 1024),
            signature = value.requiredTerminalSessionBase64("signature", "Terminal command signature", 8, 256),
        )
    }
}

data class TerminalStaffSession(
    val sessionId: String,
    val staffId: String,
    val businessId: String,
    val branchId: String,
    val hubDeviceId: String,
    val terminalDeviceId: String,
    val terminalSigningPublicKeyBase64: String,
    val role: String,
    val issuedAt: String,
    val expiresAt: String,
    val revocationVersion: Long,
    val envelopeJson: String,
    val lastAllocatedSequence: Long = -1L,
    val pendingCommand: TerminalCommandIntent? = null,
) {
    fun toStorageJson(): JSONObject = JSONObject()
        .put("sessionId", sessionId)
        .put("staffId", staffId)
        .put("businessId", businessId)
        .put("branchId", branchId)
        .put("hubDeviceId", hubDeviceId)
        .put("terminalDeviceId", terminalDeviceId)
        .put("terminalSigningPublicKeyBase64", terminalSigningPublicKeyBase64)
        .put("role", role)
        .put("issuedAt", issuedAt)
        .put("expiresAt", expiresAt)
        .put("revocationVersion", revocationVersion)
        .put("envelope", envelopeJson)
        .put("lastAllocatedSequence", lastAllocatedSequence)
        .put("pendingCommand", pendingCommand?.toStorageJson())

    companion object {
        fun fromStorageJson(value: JSONObject): TerminalStaffSession = TerminalStaffSession(
            sessionId = value.requiredUuid("sessionId", "Terminal staff-session ID"),
            staffId = value.requiredUuid("staffId", "Terminal staff ID"),
            businessId = value.requiredUuid("businessId", "Terminal staff-session business ID"),
            branchId = value.requiredUuid("branchId", "Terminal staff-session branch ID"),
            hubDeviceId = value.requiredTerminalSessionDeviceId("hubDeviceId", "Terminal staff-session Hub device ID"),
            terminalDeviceId = value.requiredTerminalSessionDeviceId("terminalDeviceId", "Terminal staff-session device ID"),
            terminalSigningPublicKeyBase64 = value.requiredTerminalSessionBase64(
                "terminalSigningPublicKeyBase64", "Terminal staff-session signing public key", 64, 4096
            ),
            role = value.requiredTerminalSessionText("role", "Terminal staff-session role", 32).also {
                if (it !in TERMINAL_ROLES) throw HubCommandRejectedException("The terminal staff-session role is invalid.")
            },
            issuedAt = value.requiredTerminalSessionText("issuedAt", "Terminal staff-session issue time", 24).also {
                HubTime.requireCanonicalUtc(it, "Terminal staff-session issue time")
            },
            expiresAt = value.requiredTerminalSessionText("expiresAt", "Terminal staff-session expiry", 24).also {
                HubTime.requireCanonicalUtc(it, "Terminal staff-session expiry")
            },
            revocationVersion = value.requiredNonNegativeSequence("revocationVersion").also {
                if (it < 1L) throw HubCommandRejectedException("The terminal staff-session revision is invalid.")
            },
            envelopeJson = value.requiredTerminalSessionText("envelope", "Terminal staff-session envelope", MAX_ENVELOPE_CHARS),
            lastAllocatedSequence = value.optLong("lastAllocatedSequence", -1L).also {
                if (it < -1L) throw HubCommandRejectedException("The terminal command sequence is invalid.")
            },
            pendingCommand = value.optJSONObject("pendingCommand")?.let(TerminalCommandIntent::fromStorageJson),
        )

        private const val MAX_ENVELOPE_CHARS = 128 * 1024
    }
}

data class TerminalStaffSessionInstallResult(
    val installed: Boolean,
    val session: TerminalStaffSession? = null,
    val error: String? = null,
)

/**
 * Verifies the compact cloud assertion before it can be persisted or forwarded
 * to the Hub. A terminal never treats its own cloud response, a browser value,
 * or a stale admission as authority.
 */
class TerminalStaffSessionCoordinator(
    private val keys: TerminalKeyManager,
    private val admissions: TerminalAdmissionCoordinator = TerminalAdmissionCoordinator(keys),
    private val issuerKeys: AuthorizationBundleIssuerKeyResolver = BuildConfigIssuerKeyResolver(),
) {
    fun installSignedSession(envelope: JSONObject): TerminalStaffSessionInstallResult = try {
        val session = verifyEnvelope(envelope)
        keys.saveStaffSession(session)
        TerminalStaffSessionInstallResult(installed = true, session = session)
    } catch (error: IllegalStateException) {
        TerminalStaffSessionInstallResult(false, error = error.message ?: "The terminal staff session could not be installed.")
    } catch (_: Exception) {
        TerminalStaffSessionInstallResult(false, error = "The terminal staff session could not be verified.")
    }

    fun currentSession(): TerminalStaffSession? {
        val serialized = keys.savedStaffSession() ?: return null
        return try {
            val verified = verifyEnvelope(JSONObject(serialized.envelopeJson), expectedStored = serialized)
            if (HubTime.isExpired(verified.expiresAt, HubCloudTime.now())) {
                keys.clearStaffSession()
                null
            } else {
                verified.copy(
                    lastAllocatedSequence = serialized.lastAllocatedSequence,
                    pendingCommand = serialized.pendingCommand,
                )
            }
        } catch (_: Exception) {
            keys.clearStaffSession()
            null
        }
    }

    fun clearSession() = keys.clearStaffSession()

    private fun verifyEnvelope(envelope: JSONObject, expectedStored: TerminalStaffSession? = null): TerminalStaffSession {
        if (envelope.optInt("schemaVersion", -1) != 1) {
            throw HubCommandRejectedException("The terminal staff-session envelope schema is not supported.")
        }
        val issuerKeyId = envelope.requiredTerminalSessionText("issuerKeyId", "Terminal staff-session issuer key ID", 128)
        val payloadBase64 = envelope.requiredTerminalSessionBase64("payloadBase64", "Terminal staff-session payload", 2, MAX_PAYLOAD_BASE64_CHARS)
        val signature = envelope.requiredTerminalSessionBase64("signature", "Terminal staff-session signature", 8, 256)
        val payloadBytes = HubWireEncoding.decode(payloadBase64, "Terminal staff-session payload")
        if (payloadBytes.isEmpty() || payloadBytes.size > MAX_PAYLOAD_BYTES) {
            throw HubCommandRejectedException("The terminal staff-session payload is too large.")
        }
        val issuerKey = issuerKeys.resolve(issuerKeyId)
            ?: throw HubCommandRejectedException("This application does not trust the terminal staff-session issuer.")
        if (!verifySignature(issuerKey, payloadBytes, signature)) {
            throw HubCommandRejectedException("The terminal staff-session signature is invalid.")
        }
        val payload = try {
            JSONObject(String(payloadBytes, Charsets.UTF_8))
        } catch (_: Exception) {
            throw HubCommandRejectedException("The terminal staff-session payload is not valid JSON.")
        }
        if (payload.optInt("schemaVersion", -1) != 1) {
            throw HubCommandRejectedException("The terminal staff-session payload schema is not supported.")
        }
        val admission = admissions.currentAdmission()
            ?: throw HubCommandRejectedException("A current signed terminal admission is required before a staff session can be installed.")
        val session = TerminalStaffSession(
            sessionId = payload.requiredUuid("sessionId", "Terminal staff-session ID"),
            staffId = payload.requiredUuid("staffId", "Terminal staff ID"),
            businessId = payload.requiredUuid("businessId", "Terminal staff-session business ID"),
            branchId = payload.requiredUuid("branchId", "Terminal staff-session branch ID"),
            hubDeviceId = payload.requiredTerminalSessionDeviceId("hubDeviceId", "Terminal staff-session Hub device ID"),
            terminalDeviceId = payload.requiredTerminalSessionDeviceId("terminalDeviceId", "Terminal staff-session device ID"),
            terminalSigningPublicKeyBase64 = payload.requiredTerminalSessionBase64(
                "terminalSigningPublicKeyBase64", "Terminal staff-session signing public key", 64, 4096
            ),
            role = payload.requiredTerminalSessionText("role", "Terminal staff-session role", 32),
            issuedAt = payload.requiredTerminalSessionText("issuedAt", "Terminal staff-session issue time", 24),
            expiresAt = payload.requiredTerminalSessionText("expiresAt", "Terminal staff-session expiry", 24),
            revocationVersion = payload.requiredNonNegativeSequence("revocationVersion"),
            envelopeJson = envelope.toString(),
        )
        if (session.role !in TERMINAL_ROLES || session.revocationVersion < 1L) {
            throw HubCommandRejectedException("The terminal staff-session role or revision is invalid.")
        }
        HubTime.requireCanonicalUtc(session.issuedAt, "Terminal staff-session issue time")
        HubTime.requireCanonicalUtc(session.expiresAt, "Terminal staff-session expiry")
        if (HubTime.isExpired(session.expiresAt, session.issuedAt) || HubTime.isExpired(session.expiresAt, HubCloudTime.now())) {
            throw HubCommandRejectedException("The terminal staff session is expired.")
        }
        if (session.businessId != admission.businessId || session.branchId != admission.branchId ||
            session.hubDeviceId != admission.hubDeviceId || session.terminalDeviceId != admission.terminalDeviceId ||
            session.terminalSigningPublicKeyBase64 != admission.terminalSigningPublicKeyBase64 ||
            session.role != admission.terminalRole || session.revocationVersion != admission.revocationVersion ||
            session.expiresAt > admission.expiresAt || session.terminalDeviceId != keys.terminalDeviceId() ||
            session.terminalSigningPublicKeyBase64 != keys.signingPublicKeyBase64()
        ) {
            throw HubCommandRejectedException("The terminal staff session is not bound to this admitted terminal authority.")
        }
        if (expectedStored != null && (
                expectedStored.sessionId != session.sessionId || expectedStored.staffId != session.staffId ||
                    expectedStored.businessId != session.businessId || expectedStored.branchId != session.branchId ||
                    expectedStored.hubDeviceId != session.hubDeviceId || expectedStored.terminalDeviceId != session.terminalDeviceId ||
                    expectedStored.role != session.role || expectedStored.revocationVersion != session.revocationVersion
            )
        ) {
            throw HubCommandRejectedException("The persisted terminal staff session does not match its signed assertion.")
        }
        return session
    }

    private fun verifySignature(publicKeyBase64: String, payload: ByteArray, signatureBase64: String): Boolean = try {
        val publicKey: PublicKey = KeyFactory.getInstance("EC").generatePublic(
            X509EncodedKeySpec(HubWireEncoding.decode(publicKeyBase64, "Terminal staff-session issuer public key"))
        )
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey)
            update(payload)
            verify(HubWireEncoding.decode(signatureBase64, "Terminal staff-session signature"))
        }
    } catch (_: Exception) {
        false
    }

    private companion object {
        const val MAX_PAYLOAD_BYTES = 64 * 1024
        const val MAX_PAYLOAD_BASE64_CHARS = 90 * 1024
        val TERMINAL_ROLES = setOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
    }
}

private fun JSONObject.requiredTerminalSessionText(name: String, subject: String, maxLength: Int): String {
    val result = optString(name, "").trim()
    if (result.isEmpty() || result.length > maxLength) throw HubCommandRejectedException("$subject is required.")
    return result
}

private fun JSONObject.requiredUuid(name: String, subject: String): String = try {
    UUID.fromString(requiredTerminalSessionText(name, subject, 36)).toString()
} catch (_: IllegalArgumentException) {
    throw HubCommandRejectedException("$subject must be a UUID.")
}

private fun JSONObject.requiredTerminalSessionDeviceId(name: String, subject: String): String {
    val result = requiredTerminalSessionText(name, subject, 200)
    if (!DEVICE_ID.matches(result)) throw HubCommandRejectedException("$subject is invalid.")
    return result
}

private fun JSONObject.requiredTerminalSessionBase64(name: String, subject: String, minLength: Int, maxLength: Int): String {
    val result = requiredTerminalSessionText(name, subject, maxLength)
    if (result.length < minLength) throw HubCommandRejectedException("$subject is invalid.")
    HubWireEncoding.decode(result, subject)
    return result
}

private fun JSONObject.requiredNonNegativeSequence(name: String): Long {
    if (!has(name)) throw HubCommandRejectedException("Terminal $name is required.")
    val result = optLong(name, Long.MIN_VALUE)
    if (result < 0L) throw HubCommandRejectedException("Terminal $name is invalid.")
    return result
}

private val DEVICE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
