package com.theplugos.cashierhub.native

import com.theplugos.cashierhub.BuildConfig
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.URL
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** Short-lived native-only reset challenge. This object is kept in the
 * Activity process only and contains no PIN, reset code, bearer, or key. */
data class NativeStaffCredentialResetChallenge(
    val requestId: String,
    val challengeId: String,
    val nonce: String,
    val hubDeviceId: String,
    val staffId: String,
    val staffName: String,
    val staffRole: String,
    val expiresAt: String
)

data class NativeStaffCredentialResetStartResult(
    val challenge: NativeStaffCredentialResetChallenge? = null,
    val error: String? = null
)

data class NativeStaffCredentialResetCompletionResult(
    val completed: Boolean,
    val authorityReconciled: Boolean,
    val error: String? = null
)

/**
 * Native-only client for enrollment, signed bundle renewal, and fresh staff
 * sessions. It intentionally has no Capacitor-facing method that accepts a
 * pairing code or PIN; callers are native Android activities/services only.
 */
class HubCloudAuthorityClient(
    private val runtime: CashierHubRuntime,
    private val coordinator: HubEnrollmentCoordinator = HubEnrollmentCoordinator(runtime)
) {
    fun enrollCashierHub(pairingCode: CharArray, hubName: String = "Cashier Hub"): EnrollmentInstallResult {
        return try {
            requireNoPendingEventsForAuthorityChange()
            val proof = runtime.enrollmentProof()
            val requestId = UUID.randomUUID().toString()
            val begin = post("hub-enrollment", JSONObject()
                .put("action", "begin")
                .put("pairingCode", String(pairingCode))
                .put("requestId", requestId)
                .put("hubDeviceId", stableDeviceId())
                .put("hubName", hubName.trim().ifBlank { "Cashier Hub" })
                .put("signingPublicKeyBase64", proof.signingPublicKeyBase64)
                .put("tlsCertificateBase64", proof.tlsCertificateBase64)
                .put("tlsCertificateSha256", proof.tlsCertificateSha256)
            )
            pairingCode.fill('\u0000')
            val challengeId = begin.requiredString("challengeId")
            val nonce = begin.requiredString("nonce")
            val signedProof = runtime.signCloudProtocol(
                HubCloudProtocol.enrollmentChallengeBytes(
                    requestId, challengeId, nonce,
                    proof.signingPublicKeyBase64, proof.tlsCertificateSha256
                )
            )
            val complete = post("hub-enrollment", JSONObject()
                .put("action", "complete")
                .put("requestId", requestId)
                .put("challengeId", challengeId)
                .put("nonce", nonce)
                .put("hubDeviceId", stableDeviceId())
                .put("signingPublicKeyBase64", proof.signingPublicKeyBase64)
                .put("tlsCertificateSha256", proof.tlsCertificateSha256)
                .put("signature", signedProof)
            )
            coordinator.installSignedBundle(complete.requiredObject("envelope"))
        } catch (error: IllegalStateException) {
            pairingCode.fill('\u0000')
            EnrollmentInstallResult(installed = false, error = error.message ?: "Hub enrollment could not be completed.")
        } catch (_: Exception) {
            pairingCode.fill('\u0000')
            EnrollmentInstallResult(installed = false, error = "Hub enrollment could not be completed.")
        }
    }

    fun renewAuthorizationBundle(): EnrollmentInstallResult {
        return try {
            requireNoPendingEventsForAuthorityChange()
            val active = runtime.activeAuthorizationBundleForCloud()
                ?: throw HubUnavailableException("This Hub is not enrolled.")
            val requestId = UUID.randomUUID().toString()
            val issuedAt = HubClock.now()
            val signature = runtime.signCloudProtocol(
                HubCloudProtocol.bundleRenewalBytes(requestId, active.hubDeviceId, active.bundleId, issuedAt)
            )
            val response = post("hub-enrollment", JSONObject()
                .put("action", "renew")
                .put("requestId", requestId)
                .put("hubDeviceId", active.hubDeviceId)
                .put("bundleId", active.bundleId)
                .put("issuedAt", issuedAt)
                .put("signature", signature)
            )
            coordinator.installSignedBundle(response.requiredObject("envelope"))
        } catch (error: IllegalStateException) {
            EnrollmentInstallResult(installed = false, error = error.message ?: "Hub authorization renewal failed.")
        } catch (_: Exception) {
            EnrollmentInstallResult(installed = false, error = "Hub authorization renewal failed.")
        }
    }

    /**
     * Reconcile the cloud authority revision without issuing a replacement
     * bundle when nothing changed. A terminal enrollment/revocation returns a
     * normal signed bundle, which passes the existing verification boundary.
     */
    fun reconcileAuthorizationBundle(): EnrollmentInstallResult {
        return try {
            requireNoPendingEventsForAuthorityChange()
            val active = runtime.activeAuthorizationBundleForCloud()
                ?: throw HubUnavailableException("This Hub is not enrolled.")
            val requestId = UUID.randomUUID().toString()
            val issuedAt = HubClock.now()
            val signature = runtime.signCloudProtocol(
                HubCloudProtocol.bundleRenewalBytes(requestId, active.hubDeviceId, active.bundleId, issuedAt)
            )
            val response = post("hub-enrollment", JSONObject()
                .put("action", "reconcile")
                .put("requestId", requestId)
                .put("hubDeviceId", active.hubDeviceId)
                .put("bundleId", active.bundleId)
                .put("issuedAt", issuedAt)
                .put("signature", signature)
            )
            if (response.has("changed") && !response.optBoolean("changed", true)) {
                EnrollmentInstallResult(installed = true, bundleId = active.bundleId)
            } else {
                coordinator.installSignedBundle(response.requiredObject("envelope"))
            }
        } catch (error: IllegalStateException) {
            EnrollmentInstallResult(installed = false, error = error.message ?: "Hub authority reconciliation failed.")
        } catch (_: Exception) {
            EnrollmentInstallResult(installed = false, error = "Hub authority reconciliation failed.")
        }
    }

    fun startNativeStaffSession(staffId: String, pin: CharArray): EnrollmentInstallResult {
        return try {
            requireNoPendingEventsForAuthorityChange()
            val active = runtime.activeAuthorizationBundleForCloud()
                ?: throw HubUnavailableException("This Hub is not enrolled.")
            val requestId = UUID.randomUUID().toString()
            val begin = post("hub-staff-session", JSONObject()
                .put("action", "begin")
                .put("requestId", requestId)
                .put("hubDeviceId", active.hubDeviceId)
                .put("staffId", staffId)
            )
            val challengeId = begin.requiredString("challengeId")
            val nonce = begin.requiredString("nonce")
            val signature = runtime.signCloudProtocol(
                HubCloudProtocol.staffSessionChallengeBytes(
                    requestId, challengeId, nonce, active.hubDeviceId, staffId
                )
            )
            val complete = post("hub-staff-session", JSONObject()
                .put("action", "complete")
                .put("requestId", requestId)
                .put("challengeId", challengeId)
                .put("nonce", nonce)
                .put("hubDeviceId", active.hubDeviceId)
                .put("staffId", staffId)
                .put("signature", signature)
                .put("pin", String(pin))
            )
            pin.fill('\u0000')
            val activeStaffSessionId = complete.requiredString("activeStaffSessionId")
            val installed = coordinator.installSignedBundle(complete.requiredObject("envelope"))
            if (installed.installed) runtime.activateNativeStaffSession(activeStaffSessionId)
            installed
        } catch (error: IllegalStateException) {
            pin.fill('\u0000')
            EnrollmentInstallResult(installed = false, error = error.message ?: "Native staff sign-in failed.")
        } catch (_: Exception) {
            pin.fill('\u0000')
            EnrollmentInstallResult(installed = false, error = "Native staff sign-in failed.")
        }
    }

    /**
     * Starts an owner-authorized recovery flow after the code has been entered
     * in a native Android window. The browser cannot invoke this method or
     * supply its code/PIN through Capacitor.
     */
    fun beginNativeStaffCredentialReset(resetCode: CharArray): NativeStaffCredentialResetStartResult {
        return try {
            requireNoPendingEventsForAuthorityChange()
            val active = runtime.activeAuthorizationBundleForCloud()
                ?: throw HubUnavailableException("This Hub is not enrolled.")
            val requestId = UUID.randomUUID().toString()
            val begin = post("hub-staff-credential-reset", JSONObject()
                .put("action", "begin")
                .put("resetCode", String(resetCode))
                .put("requestId", requestId)
                .put("hubDeviceId", active.hubDeviceId)
            )
            val challengeId = begin.requiredString("challengeId")
            val nonce = begin.requiredString("nonce")
            val staffId = begin.requiredString("staffId")
            val staffName = begin.requiredString("staffName")
            val staffRole = begin.requiredString("staffRole")
            val expiresAt = begin.requiredString("expiresAt")
            UUID.fromString(challengeId)
            UUID.fromString(staffId)
            val signedStaff = runtime.nativeStaffDirectory().singleOrNull { it.staffId == staffId }
                ?: throw HubUnavailableException("This Hub's signed staff directory is stale. Reconcile authority before resetting a credential.")
            if (signedStaff.name != staffName || signedStaff.role != staffRole) {
                throw HubUnavailableException("The recovery target does not match this Hub's signed staff directory.")
            }
            NativeStaffCredentialResetStartResult(
                challenge = NativeStaffCredentialResetChallenge(
                    requestId = requestId,
                    challengeId = challengeId,
                    nonce = nonce,
                    hubDeviceId = active.hubDeviceId,
                    staffId = staffId,
                    staffName = staffName,
                    staffRole = staffRole,
                    expiresAt = expiresAt
                )
            )
        } catch (error: IllegalStateException) {
            NativeStaffCredentialResetStartResult(error = error.message ?: "Credential reset could not be started.")
        } catch (_: Exception) {
            NativeStaffCredentialResetStartResult(error = "Credential reset could not be started.")
        } finally {
            resetCode.fill('\u0000')
        }
    }

    /**
     * Completes a recovery challenge only after the Keystore signs the exact
     * cloud protocol bytes. On success, all branch staff continuations are
     * invalidated by R012, so the native local selection is ended before the
     * Hub installs its newly reconciled signed authority.
     */
    fun completeNativeStaffCredentialReset(
        challenge: NativeStaffCredentialResetChallenge,
        pin: CharArray
    ): NativeStaffCredentialResetCompletionResult {
        return try {
            requireNoPendingEventsForAuthorityChange()
            val active = runtime.activeAuthorizationBundleForCloud()
                ?: throw HubUnavailableException("This Hub is not enrolled.")
            if (active.hubDeviceId != challenge.hubDeviceId) {
                throw HubUnavailableException("Hub authority changed while the credential reset was pending.")
            }
            val signedStaff = runtime.nativeStaffDirectory().singleOrNull { it.staffId == challenge.staffId }
                ?: throw HubUnavailableException("This Hub's signed staff directory is stale. Reconcile authority before completing a credential reset.")
            if (signedStaff.name != challenge.staffName || signedStaff.role != challenge.staffRole) {
                throw HubUnavailableException("The recovery target no longer matches this Hub's signed staff directory.")
            }
            val signature = runtime.signCloudProtocol(
                HubCloudProtocol.staffCredentialResetChallengeBytes(
                    challenge.requestId,
                    challenge.challengeId,
                    challenge.nonce,
                    challenge.hubDeviceId,
                    challenge.staffId
                )
            )
            val complete = post("hub-staff-credential-reset", JSONObject()
                .put("action", "complete")
                .put("requestId", challenge.requestId)
                .put("challengeId", challenge.challengeId)
                .put("nonce", challenge.nonce)
                .put("hubDeviceId", challenge.hubDeviceId)
                .put("staffId", challenge.staffId)
                .put("signature", signature)
                .put("pin", String(pin))
            )
            if (complete.requiredString("state") != "COMPLETE"
                || complete.requiredString("staffId") != challenge.staffId
                || complete.optLong("revocationVersion", 0L) < 1L) {
                throw HubUnavailableException("The Hub cloud receiver returned an invalid credential-reset completion.")
            }
            // A successful R012 reset revokes every branch staff session.
            // Ending the local selector prevents the old bundle from being
            // used while the cloud reconciliation transaction is in flight.
            runtime.endNativeStaffSession()
            val reconciliation = reconcileAuthorizationBundle()
            if (!reconciliation.installed) {
                NativeStaffCredentialResetCompletionResult(
                    completed = true,
                    authorityReconciled = false,
                    error = reconciliation.error ?: "Credential reset completed, but this Hub must reconnect and reconcile before staff sign-in."
                )
            } else {
                NativeStaffCredentialResetCompletionResult(completed = true, authorityReconciled = true)
            }
        } catch (error: IllegalStateException) {
            NativeStaffCredentialResetCompletionResult(
                completed = false,
                authorityReconciled = false,
                error = error.message ?: "Credential reset could not be completed."
            )
        } catch (_: Exception) {
            NativeStaffCredentialResetCompletionResult(
                completed = false,
                authorityReconciled = false,
                error = "Credential reset could not be completed."
            )
        } finally {
            pin.fill('\u0000')
        }
    }

    fun isConfigured(): Boolean = BuildConfig.HUB_CLOUD_FUNCTIONS_BASE_URL.trim().startsWith("https://")

    private fun requireNoPendingEventsForAuthorityChange() {
        if (runtime.hasPendingOperationalOutboxForAuthorityChange()) {
            throw HubUnavailableException(
                "DEFERRED_UNTIL_SYNC: Cloud acknowledgement is required before replacing Hub authority or starting a fresh staff session."
            )
        }
    }

    private fun stableDeviceId(): String {
        val active = runtime.activeAuthorizationBundleForCloud()
        return active?.hubDeviceId ?: runtime.hubDeviceIdForCloud()
    }

    private fun post(functionName: String, body: JSONObject): JSONObject {
        val base = BuildConfig.HUB_CLOUD_FUNCTIONS_BASE_URL.trim().removeSuffix("/")
        if (!base.startsWith("https://")) throw HubUnavailableException("The Hub cloud receiver is not configured.")
        val connection = (URL("$base/$functionName").openConnection() as? HttpsURLConnection)
            ?: throw HubUnavailableException("The Hub cloud receiver is unavailable.")
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
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.let(::readBounded) ?: ""
            if (status !in 200..299) {
                throw HubUnavailableException("The Hub cloud receiver rejected the request.")
            }
            val parsed = try { JSONObject(response) } catch (_: Exception) {
                throw HubUnavailableException("The Hub cloud receiver returned an invalid response.")
            }
            if (!parsed.optBoolean("ok", false)) throw HubUnavailableException("The Hub cloud receiver rejected the request.")
            return parsed
        } finally {
            connection.disconnect()
        }
    }

    /**
     * A receiver is untrusted until the response has passed all protocol
     * checks.  Do not use Reader.readText(): it can allocate an unbounded
     * response before the size check runs.
     */
    private fun readBounded(stream: java.io.InputStream): String = stream.bufferedReader(Charsets.UTF_8).use { reader ->
        val buffer = CharArray(4096)
        val output = StringBuilder()
        while (true) {
            val count = reader.read(buffer)
            if (count < 0) break
            if (output.length + count > MAX_RESPONSE_CHARS) {
                throw HubUnavailableException("The Hub cloud receiver response is too large.")
            }
            output.append(buffer, 0, count)
        }
        output.toString()
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 20_000
        const val MAX_RESPONSE_CHARS = 128 * 1024
    }
}

private object HubClock {
    fun now(): String = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
        timeZone = java.util.TimeZone.getTimeZone("UTC")
    }.format(java.util.Date())
}

private fun JSONObject.requiredString(name: String): String {
    val value = optString(name, "").trim()
    if (value.isEmpty()) throw HubUnavailableException("The Hub cloud receiver returned an incomplete response.")
    return value
}

private fun JSONObject.requiredObject(name: String): JSONObject = optJSONObject(name)
    ?: throw HubUnavailableException("The Hub cloud receiver returned an incomplete response.")
