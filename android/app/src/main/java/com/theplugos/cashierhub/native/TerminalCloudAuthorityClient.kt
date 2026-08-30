package com.theplugos.cashierhub.native

import com.theplugos.cashierhub.BuildConfig
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.URL
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/**
 * Native-only terminal enrollment client. It deliberately has no Capacitor
 * method and it never accepts a device identity or admission from the web
 * layer. The native terminal creates its own Keystore key before asking the
 * cloud to bind it to a short-lived owner-issued code.
 */
class TerminalCloudAuthorityClient(
    private val keys: TerminalKeyManager,
    private val coordinator: TerminalAdmissionCoordinator = TerminalAdmissionCoordinator(keys)
) {
    private val staffSessions = TerminalStaffSessionCoordinator(keys, coordinator)
    fun enrollTerminal(
        pairingCode: CharArray,
        terminalName: String,
        terminalRole: String
    ): TerminalAdmissionInstallResult {
        return try {
            val cleanName = terminalName.trim()
            require(cleanName.isNotEmpty() && cleanName.length <= 120) {
                "A terminal name is required."
            }
            require(terminalRole in TERMINAL_ROLES) {
                "The terminal role is invalid."
            }
            val requestId = UUID.randomUUID().toString()
            val terminalDeviceId = keys.terminalDeviceId()
            val publicKey = keys.signingPublicKeyBase64()
            val begin = post(
                "hub-terminal-enrollment",
                JSONObject()
                    .put("action", "begin")
                    .put("pairingCode", String(pairingCode))
                    .put("requestId", requestId)
                    .put("terminalDeviceId", terminalDeviceId)
                    .put("terminalName", cleanName)
                    .put("terminalRole", terminalRole)
                    .put("signingPublicKeyBase64", publicKey)
            )
            pairingCode.fill('\u0000')
            val challengeId = begin.requiredTerminalString("challengeId")
            val nonce = begin.requiredTerminalString("nonce")
            val signature = keys.sign(
                HubCloudProtocol.terminalEnrollmentChallengeBytes(
                    requestId,
                    challengeId,
                    nonce,
                    terminalDeviceId,
                    publicKey
                )
            )
            val completed = post(
                "hub-terminal-enrollment",
                JSONObject()
                    .put("action", "complete")
                    .put("requestId", requestId)
                    .put("challengeId", challengeId)
                    .put("nonce", nonce)
                    .put("terminalDeviceId", terminalDeviceId)
                    .put("signingPublicKeyBase64", publicKey)
                    .put("signature", signature)
            )
            coordinator.installSignedAdmission(completed.requiredTerminalObject("envelope"))
        } catch (error: IllegalStateException) {
            pairingCode.fill('\u0000')
            TerminalAdmissionInstallResult(
                installed = false,
                error = error.message ?: "The terminal could not be enrolled."
            )
        } catch (_: Exception) {
            pairingCode.fill('\u0000')
            TerminalAdmissionInstallResult(installed = false, error = "The terminal could not be enrolled.")
        }
    }

    /** Renews an existing terminal admission with a fresh proof from the same
     * non-exportable Keystore key. It cannot change terminal role, branch,
     * Hub, or key; those remain cloud authority facts. */
    fun renewTerminalAdmission(): TerminalAdmissionInstallResult {
        return try {
            val existing = coordinator.renewableAdmission()
                ?: throw HubUnavailableException("This terminal has no renewable signed admission.")
            val requestId = UUID.randomUUID().toString()
            val terminalDeviceId = keys.terminalDeviceId()
            val publicKey = keys.signingPublicKeyBase64()
            if (terminalDeviceId != existing.terminalDeviceId || publicKey != existing.terminalSigningPublicKeyBase64) {
                throw HubUnavailableException("This terminal admission is not bound to the current Android Keystore identity.")
            }
            val begin = post(
                "hub-terminal-enrollment",
                JSONObject()
                    .put("action", "renew-begin")
                    .put("requestId", requestId)
                    .put("terminalDeviceId", terminalDeviceId)
                    .put("signingPublicKeyBase64", publicKey)
            )
            val challengeId = begin.requiredTerminalString("challengeId")
            val nonce = begin.requiredTerminalString("nonce")
            val signature = keys.sign(
                HubCloudProtocol.terminalRenewalChallengeBytes(
                    requestId,
                    challengeId,
                    nonce,
                    terminalDeviceId,
                    publicKey
                )
            )
            val completed = post(
                "hub-terminal-enrollment",
                JSONObject()
                    .put("action", "renew-complete")
                    .put("requestId", requestId)
                    .put("challengeId", challengeId)
                    .put("nonce", nonce)
                    .put("terminalDeviceId", terminalDeviceId)
                    .put("signingPublicKeyBase64", publicKey)
                    .put("signature", signature)
            )
            coordinator.installSignedAdmission(completed.requiredTerminalObject("envelope"))
        } catch (error: IllegalStateException) {
            TerminalAdmissionInstallResult(
                installed = false,
                error = error.message ?: "The terminal admission could not be renewed."
            )
        } catch (_: Exception) {
            TerminalAdmissionInstallResult(installed = false, error = "The terminal admission could not be renewed.")
        }
    }

    fun currentAdmission(): TerminalAdmission? = coordinator.currentAdmission()

    /** Starts a fresh native terminal staff session. The caller must first
     * measure an authenticated local link; this method independently binds the
     * cloud PIN proof to the currently admitted terminal key and active Hub. */
    fun startTerminalStaffSession(staffIdValue: String, pin: CharArray): TerminalStaffSessionInstallResult {
        return try {
            val admission = coordinator.currentAdmission()
                ?: throw HubUnavailableException("A current signed terminal admission is required before staff sign-in.")
            val staffId = UUID.fromString(staffIdValue.trim()).toString()
            val requestId = UUID.randomUUID().toString()
            val terminalDeviceId = keys.terminalDeviceId()
            val publicKey = keys.signingPublicKeyBase64()
            if (terminalDeviceId != admission.terminalDeviceId || publicKey != admission.terminalSigningPublicKeyBase64) {
                throw HubUnavailableException("The terminal admission is not bound to this Android Keystore identity.")
            }
            val begin = post(
                "hub-terminal-staff-session",
                JSONObject()
                    .put("action", "begin")
                    .put("requestId", requestId)
                    .put("terminalDeviceId", terminalDeviceId)
                    .put("staffId", staffId)
            )
            val challengeId = begin.requiredTerminalString("challengeId")
            val nonce = begin.requiredTerminalString("nonce")
            val signature = keys.sign(
                HubCloudProtocol.terminalStaffSessionChallengeBytes(
                    requestId,
                    challengeId,
                    nonce,
                    terminalDeviceId,
                    admission.hubDeviceId,
                    staffId,
                )
            )
            val completed = post(
                "hub-terminal-staff-session",
                JSONObject()
                    .put("action", "complete")
                    .put("requestId", requestId)
                    .put("challengeId", challengeId)
                    .put("nonce", nonce)
                    .put("terminalDeviceId", terminalDeviceId)
                    .put("hubDeviceId", admission.hubDeviceId)
                    .put("staffId", staffId)
                    .put("signature", signature)
                    .put("pin", String(pin))
            )
            val expectedSessionId = completed.requiredTerminalString("activeStaffSessionId")
            val installed = staffSessions.installSignedSession(completed.requiredTerminalObject("envelope"))
            if (!installed.installed || installed.session?.sessionId != expectedSessionId) {
                staffSessions.clearSession()
                TerminalStaffSessionInstallResult(
                    installed = false,
                    error = installed.error ?: "The terminal staff session did not match the verified cloud assertion."
                )
            } else {
                installed
            }
        } catch (error: IllegalStateException) {
            TerminalStaffSessionInstallResult(
                installed = false,
                error = error.message ?: "The terminal staff session could not be started."
            )
        } catch (_: Exception) {
            TerminalStaffSessionInstallResult(installed = false, error = "The terminal staff session could not be started.")
        } finally {
            pin.fill('\u0000')
        }
    }

    fun currentTerminalStaffSession(): TerminalStaffSession? = staffSessions.currentSession()

    fun clearTerminalStaffSession() = staffSessions.clearSession()

    fun isConfigured(): Boolean = BuildConfig.HUB_CLOUD_FUNCTIONS_BASE_URL.trim().startsWith("https://")

    private fun post(functionName: String, body: JSONObject): JSONObject {
        val base = BuildConfig.HUB_CLOUD_FUNCTIONS_BASE_URL.trim().removeSuffix("/")
        if (!base.startsWith("https://")) {
            throw HubUnavailableException("The terminal cloud receiver is not configured.")
        }
        val connection = (URL(base + "/" + functionName).openConnection() as? HttpsURLConnection)
            ?: throw HubUnavailableException("The terminal cloud receiver is unavailable.")
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { output ->
                output.write(body.toString())
            }
            val status = connection.responseCode
            val response = readBounded(if (status in 200..299) connection.inputStream else connection.errorStream)
            if (status !in 200..299) {
                throw HubUnavailableException("The terminal cloud receiver rejected the request.")
            }
            val parsed = try {
                JSONObject(response)
            } catch (_: Exception) {
                throw HubUnavailableException("The terminal cloud receiver returned an invalid response.")
            }
            if (!parsed.optBoolean("ok", false)) {
                throw HubUnavailableException("The terminal cloud receiver rejected the request.")
            }
            return parsed
        } finally {
            connection.disconnect()
        }
    }

    private fun readBounded(stream: java.io.InputStream?): String {
        if (stream == null) throw HubUnavailableException("The terminal cloud receiver is unavailable.")
        return stream.bufferedReader(Charsets.UTF_8).use { reader ->
            val buffer = CharArray(4096)
            val output = StringBuilder()
            while (true) {
                val count = reader.read(buffer)
                if (count < 0) break
                if (output.length + count > MAX_RESPONSE_CHARS) {
                    throw HubUnavailableException("The terminal cloud receiver response is too large.")
                }
                output.append(buffer, 0, count)
            }
            output.toString()
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 20_000
        const val MAX_RESPONSE_CHARS = 128 * 1024
        val TERMINAL_ROLES = setOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
    }
}

private fun JSONObject.requiredTerminalString(name: String): String {
    val value = optString(name, "").trim()
    if (value.isEmpty()) throw HubUnavailableException("The terminal cloud receiver returned an incomplete response.")
    return value
}

private fun JSONObject.requiredTerminalObject(name: String): JSONObject = optJSONObject(name)
    ?: throw HubUnavailableException("The terminal cloud receiver returned an incomplete response.")
