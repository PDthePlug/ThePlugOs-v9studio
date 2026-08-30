package com.theplugos.cashierhub.native

import org.json.JSONObject
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

data class VerifiedTerminalStaffSessionAssertion(
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
)

data class TerminalStaffSessionInstallReceipt(
    val sessionId: String,
    val role: String,
    val expiresAt: String,
)

/**
 * The Hub verifies a compact terminal-session assertion independently of the
 * terminal's own verification. This keeps a compromised terminal UI, replayed
 * local message, or stale assertion out of the SQLCipher authority ledger.
 */
class HubTerminalStaffSessionVerifier(
    private val database: HubDatabase,
    private val issuerKeys: AuthorizationBundleIssuerKeyResolver = BuildConfigIssuerKeyResolver(),
    private val nowIso: () -> String,
) {
    fun verify(envelope: JSONObject, authenticatedTerminalDeviceId: String): VerifiedTerminalStaffSessionAssertion {
        if (envelope.optInt("schemaVersion", -1) != 1) {
            throw HubCommandRejectedException("The terminal staff-session envelope schema is not supported.")
        }
        val issuerKeyId = envelope.requiredHubTerminalText("issuerKeyId", "Terminal staff-session issuer key ID", 128)
        val payloadBase64 = envelope.requiredHubTerminalBase64("payloadBase64", "Terminal staff-session payload", 2, MAX_PAYLOAD_BASE64_CHARS)
        val signature = envelope.requiredHubTerminalBase64("signature", "Terminal staff-session signature", 8, 256)
        val payloadBytes = HubWireEncoding.decode(payloadBase64, "Terminal staff-session payload")
        if (payloadBytes.isEmpty() || payloadBytes.size > MAX_PAYLOAD_BYTES) {
            throw HubCommandRejectedException("The terminal staff-session payload is too large.")
        }
        val issuerKey = issuerKeys.resolve(issuerKeyId)
            ?: throw HubCommandRejectedException("This Hub does not trust the terminal staff-session issuer.")
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
        val assertion = VerifiedTerminalStaffSessionAssertion(
            sessionId = payload.requiredHubTerminalUuid("sessionId", "Terminal staff-session ID"),
            staffId = payload.requiredHubTerminalUuid("staffId", "Terminal staff ID"),
            businessId = payload.requiredHubTerminalUuid("businessId", "Terminal staff-session business ID"),
            branchId = payload.requiredHubTerminalUuid("branchId", "Terminal staff-session branch ID"),
            hubDeviceId = payload.requiredHubTerminalDeviceId("hubDeviceId", "Terminal staff-session Hub device ID"),
            terminalDeviceId = payload.requiredHubTerminalDeviceId("terminalDeviceId", "Terminal staff-session device ID"),
            terminalSigningPublicKeyBase64 = payload.requiredHubTerminalBase64(
                "terminalSigningPublicKeyBase64", "Terminal staff-session signing public key", 64, 4096
            ),
            role = payload.requiredHubTerminalText("role", "Terminal staff-session role", 32),
            issuedAt = payload.requiredHubTerminalText("issuedAt", "Terminal staff-session issue time", 24),
            expiresAt = payload.requiredHubTerminalText("expiresAt", "Terminal staff-session expiry", 24),
            revocationVersion = payload.requiredHubTerminalNonNegativeLong("revocationVersion"),
        )
        if (assertion.role !in TERMINAL_ROLES || assertion.revocationVersion < 1L) {
            throw HubCommandRejectedException("The terminal staff-session role or revision is invalid.")
        }
        HubTime.requireCanonicalUtc(assertion.issuedAt, "Terminal staff-session issue time")
        HubTime.requireCanonicalUtc(assertion.expiresAt, "Terminal staff-session expiry")
        val now = nowIso()
        if (HubTime.isExpired(assertion.expiresAt, assertion.issuedAt) || HubTime.isExpired(assertion.expiresAt, now)) {
            throw HubCommandRejectedException("The terminal staff session is expired.")
        }
        // A cloud timestamp may lead the Hub clock slightly, but an assertion
        // from far in the future is never usable authority.
        if (assertion.issuedAt > HubTime.addMilliseconds(now, MAX_ISSUE_FUTURE_MS)) {
            throw HubCommandRejectedException("The terminal staff-session issue time is invalid.")
        }
        val bundle = database.activeAuthorizationBundle()
            ?: throw HubUnavailableException("This Hub has no active authorization bundle.")
        if (assertion.businessId != bundle.businessId || assertion.branchId != bundle.branchId ||
            assertion.hubDeviceId != bundle.hubDeviceId || assertion.terminalDeviceId != authenticatedTerminalDeviceId ||
            assertion.revocationVersion != bundle.revocationVersion || assertion.expiresAt > bundle.expiresAt
        ) {
            throw HubCommandRejectedException("The terminal staff session is not bound to the active Hub authority.")
        }
        val terminal = database.pairedDevice(assertion.terminalDeviceId)
            ?: throw HubCommandRejectedException("The terminal staff session is not bound to a paired terminal.")
        if (terminal.status != "ACTIVE" || terminal.revokedAt != null || terminal.businessId != bundle.businessId ||
            terminal.branchId != bundle.branchId || terminal.publicKeyBase64 != assertion.terminalSigningPublicKeyBase64 ||
            terminal.role != assertion.role
        ) {
            throw HubCommandRejectedException("The terminal staff session does not match the authenticated terminal.")
        }
        return assertion
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
        const val MAX_ISSUE_FUTURE_MS = 5 * 60_000L
        val TERMINAL_ROLES = setOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
    }
}

private fun JSONObject.requiredHubTerminalText(name: String, subject: String, maxLength: Int): String {
    val result = optString(name, "").trim()
    if (result.isEmpty() || result.length > maxLength) throw HubCommandRejectedException("$subject is required.")
    return result
}

private fun JSONObject.requiredHubTerminalUuid(name: String, subject: String): String = try {
    UUID.fromString(requiredHubTerminalText(name, subject, 36)).toString()
} catch (_: IllegalArgumentException) {
    throw HubCommandRejectedException("$subject must be a UUID.")
}

private fun JSONObject.requiredHubTerminalDeviceId(name: String, subject: String): String {
    val result = requiredHubTerminalText(name, subject, 200)
    if (!HUB_TERMINAL_DEVICE_ID.matches(result)) throw HubCommandRejectedException("$subject is invalid.")
    return result
}

private fun JSONObject.requiredHubTerminalBase64(name: String, subject: String, minLength: Int, maxLength: Int): String {
    val result = requiredHubTerminalText(name, subject, maxLength)
    if (result.length < minLength) throw HubCommandRejectedException("$subject is invalid.")
    HubWireEncoding.decode(result, subject)
    return result
}

private fun JSONObject.requiredHubTerminalNonNegativeLong(name: String): Long {
    if (!has(name)) throw HubCommandRejectedException("Terminal $name is required.")
    val result = optLong(name, -1L)
    if (result < 0L) throw HubCommandRejectedException("Terminal $name is invalid.")
    return result
}

private val HUB_TERMINAL_DEVICE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
