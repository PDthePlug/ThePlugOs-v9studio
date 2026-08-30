package com.theplugos.cashierhub.native

import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

data class TerminalAdmission(
    val admissionId: String,
    val businessId: String,
    val branchId: String,
    val hubDeviceId: String,
    val hubTlsCertificateSha256: String,
    val terminalDeviceId: String,
    val terminalSigningPublicKeyBase64: String,
    val terminalRole: String,
    val issuedAt: String,
    val expiresAt: String,
    val revocationVersion: Long,
    val allowedTransports: Set<String>,
    val envelopeJson: String
)

data class TerminalAdmissionInstallResult(
    val installed: Boolean,
    val admission: TerminalAdmission? = null,
    val error: String? = null
)

/**
 * Validates a terminal admission against a public key pinned into the Android
 * release. A cloud row or an unverified Wi-Fi/BLE advertisement is never
 * sufficient to replace this admission.
 */
class TerminalAdmissionCoordinator(
    private val keys: TerminalKeyManager,
    private val issuerKeys: AuthorizationBundleIssuerKeyResolver = BuildConfigIssuerKeyResolver()
) {
    fun installSignedAdmission(envelope: JSONObject): TerminalAdmissionInstallResult = try {
        val admission = verifyEnvelope(envelope)
        keys.saveAdmission(admission.envelopeJson)
        TerminalAdmissionInstallResult(installed = true, admission = admission)
    } catch (error: IllegalStateException) {
        TerminalAdmissionInstallResult(
            installed = false,
            error = error.message ?: "The terminal admission could not be installed."
        )
    } catch (_: Exception) {
        TerminalAdmissionInstallResult(installed = false, error = "The terminal admission could not be verified.")
    }

    fun currentAdmission(): TerminalAdmission? {
        val serialized = keys.savedAdmission() ?: return null
        return try {
            // Preserve an otherwise-valid expired envelope for the distinct
            // proof-of-possession renewal flow.  The caller still receives
            // null, so an expired admission can never start local discovery
            // or a pinned transport connection.
            val admission = verifyEnvelope(JSONObject(serialized), allowExpired = true)
            if (HubTime.isExpired(admission.expiresAt, HubCloudTime.now())) {
                null
            } else {
                admission
            }
        } catch (_: Exception) {
            keys.clearAdmission()
            null
        }
    }

    /** An expired but otherwise valid admission may be used only to decide
     * whether this Keystore-bound terminal can request a cloud renewal. The
     * local-link controller always calls `currentAdmission()` and therefore
     * never connects with an expired admission. */
    fun renewableAdmission(): TerminalAdmission? {
        val serialized = keys.savedAdmission() ?: return null
        return try {
            verifyEnvelope(JSONObject(serialized), allowExpired = true)
        } catch (_: Exception) {
            keys.clearAdmission()
            null
        }
    }

    private fun verifyEnvelope(envelope: JSONObject, allowExpired: Boolean = false): TerminalAdmission {
        if (envelope.optInt("schemaVersion", -1) != 1) {
            throw HubCommandRejectedException("The terminal admission envelope schema is not supported.")
        }
        val issuerKeyId = requiredNonBlank(envelope, "issuerKeyId", "Terminal admission issuer key ID")
        val payloadBase64 = requiredNonBlank(envelope, "payloadBase64", "Terminal admission payload")
        val signature = requiredNonBlank(envelope, "signature", "Terminal admission signature")
        if (payloadBase64.length > MAX_ADMISSION_BASE64_CHARS) {
            throw HubCommandRejectedException("The terminal admission payload is too large.")
        }
        val payloadBytes = HubWireEncoding.decode(payloadBase64, "Terminal admission payload")
        if (payloadBytes.isEmpty() || payloadBytes.size > MAX_ADMISSION_BYTES) {
            throw HubCommandRejectedException("The terminal admission payload is too large.")
        }
        val issuerKey = issuerKeys.resolve(issuerKeyId)
            ?: throw HubCommandRejectedException("This application does not trust the terminal admission issuer.")
        if (!verifySignature(issuerKey, payloadBytes, signature)) {
            throw HubCommandRejectedException("The terminal admission signature is invalid.")
        }
        val payload = try {
            JSONObject(String(payloadBytes, Charsets.UTF_8))
        } catch (_: Exception) {
            throw HubCommandRejectedException("The terminal admission payload is not valid JSON.")
        }
        if (payload.optInt("schemaVersion", -1) != 1) {
            throw HubCommandRejectedException("The terminal admission payload schema is not supported.")
        }

        val admissionId = requiredUuid(payload, "admissionId", "Terminal admission ID")
        val businessId = requiredUuid(payload, "businessId", "Terminal business ID")
        val branchId = requiredUuid(payload, "branchId", "Terminal branch ID")
        val hubDeviceId = requiredDeviceId(payload, "hubDeviceId", "Terminal Hub device ID")
        val fingerprint = requiredFingerprint(payload, "hubTlsCertificateSha256")
        val terminalDeviceId = requiredDeviceId(payload, "terminalDeviceId", "Terminal device ID")
        val terminalPublicKey = requiredBase64Url(payload, "terminalSigningPublicKeyBase64", "Terminal signing public key")
        val terminalRole = requiredNonBlank(payload, "terminalRole", "Terminal role")
        if (terminalRole !in TERMINAL_ROLES) {
            throw HubCommandRejectedException("The terminal admission role is invalid.")
        }
        val issuedAt = requiredNonBlank(payload, "issuedAt", "Terminal admission issue time")
        val expiresAt = requiredNonBlank(payload, "expiresAt", "Terminal admission expiry")
        HubTime.requireCanonicalUtc(issuedAt, "Terminal admission issue time")
        HubTime.requireCanonicalUtc(expiresAt, "Terminal admission expiry")
        if (HubTime.isExpired(expiresAt, issuedAt) || (!allowExpired && HubTime.isExpired(expiresAt, HubCloudTime.now()))) {
            throw HubCommandRejectedException("The terminal admission is expired.")
        }
        val revocationVersion = payload.optLong("revocationVersion", -1)
        if (revocationVersion < 1) {
            throw HubCommandRejectedException("The terminal admission revision is invalid.")
        }
        if (terminalDeviceId != keys.terminalDeviceId()) {
            throw HubCommandRejectedException("The terminal admission is bound to another device identity.")
        }
        if (terminalPublicKey != keys.signingPublicKeyBase64()) {
            throw HubCommandRejectedException("The terminal admission is bound to another device signing key.")
        }
        val allowedTransports = parseTransports(payload.optJSONArray("allowedTransports"))
        if (!allowedTransports.contains("LAN_WIFI") || !allowedTransports.contains("WIFI_DIRECT") ||
            !allowedTransports.contains("BLE_PROXIMITY")
        ) {
            throw HubCommandRejectedException("The terminal admission does not support the required local-link policy.")
        }
        return TerminalAdmission(
            admissionId = admissionId,
            businessId = businessId,
            branchId = branchId,
            hubDeviceId = hubDeviceId,
            hubTlsCertificateSha256 = fingerprint,
            terminalDeviceId = terminalDeviceId,
            terminalSigningPublicKeyBase64 = terminalPublicKey,
            terminalRole = terminalRole,
            issuedAt = issuedAt,
            expiresAt = expiresAt,
            revocationVersion = revocationVersion,
            allowedTransports = allowedTransports,
            envelopeJson = envelope.toString()
        )
    }

    private fun parseTransports(values: JSONArray?): Set<String> {
        if (values == null || values.length() !in 1..3) {
            throw HubCommandRejectedException("The terminal admission local-link policy is invalid.")
        }
        val transports = buildSet {
            for (index in 0 until values.length()) {
                val transport = values.optString(index, "").trim()
                if (transport !in ALLOWED_TRANSPORTS || !add(transport)) {
                    throw HubCommandRejectedException("The terminal admission local-link policy is invalid.")
                }
            }
        }
        return transports
    }

    private fun verifySignature(publicKeyBase64: String, payload: ByteArray, signatureBase64: String): Boolean = try {
        val publicKey: PublicKey = KeyFactory.getInstance("EC").generatePublic(
            X509EncodedKeySpec(HubWireEncoding.decode(publicKeyBase64, "Terminal admission issuer public key"))
        )
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey)
            update(payload)
            verify(HubWireEncoding.decode(signatureBase64, "Terminal admission signature"))
        }
    } catch (_: Exception) {
        false
    }

    private fun requiredNonBlank(value: JSONObject, name: String, subject: String): String {
        val result = value.optString(name, "").trim()
        if (result.isEmpty() || result.length > MAX_FIELD_CHARS) {
            throw HubCommandRejectedException(subject + " is required.")
        }
        return result
    }

    private fun requiredUuid(value: JSONObject, name: String, subject: String): String = try {
        UUID.fromString(requiredNonBlank(value, name, subject)).toString()
    } catch (_: IllegalArgumentException) {
        throw HubCommandRejectedException(subject + " must be a UUID.")
    }

    private fun requiredDeviceId(value: JSONObject, name: String, subject: String): String {
        val result = requiredNonBlank(value, name, subject)
        if (!DEVICE_ID.matches(result)) throw HubCommandRejectedException(subject + " is invalid.")
        return result
    }

    private fun requiredFingerprint(value: JSONObject, name: String): String {
        val result = requiredNonBlank(value, name, "Hub TLS certificate fingerprint").lowercase()
        if (!FINGERPRINT.matches(result)) throw HubCommandRejectedException("Hub TLS certificate fingerprint is invalid.")
        return result
    }

    private fun requiredBase64Url(value: JSONObject, name: String, subject: String): String {
        val result = requiredNonBlank(value, name, subject)
        if (result.length !in 64..4096) {
            throw HubCommandRejectedException(subject + " is invalid.")
        }
        HubWireEncoding.decode(result, subject)
        return result
    }

    private companion object {
        const val MAX_ADMISSION_BYTES = 128 * 1024
        const val MAX_ADMISSION_BASE64_CHARS = 180 * 1024
        const val MAX_FIELD_CHARS = 4096
        val DEVICE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
        val FINGERPRINT = Regex("^[0-9a-f]{64}$")
        val TERMINAL_ROLES = setOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
        val ALLOWED_TRANSPORTS = setOf("LAN_WIFI", "WIFI_DIRECT", "BLE_PROXIMITY")
    }
}
