package com.theplugos.cashierhub.native

import com.theplugos.cashierhub.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.URL
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

data class CloudSyncSnapshot(
    val status: CloudStatus,
    val lastAcknowledgement: String?,
    val message: String
)

/**
 * Drains only durable local outbox rows. A row changes to ACKNOWLEDGED only
 * when this receiver returns its exact event ID, never just because an HTTP
 * connection succeeded.
 */
class HubCloudSyncClient(
    private val database: HubDatabase,
    private val activeBundle: () -> ActiveAuthorizationBundle?,
    private val signProtocol: (ByteArray) -> String
) {
    private val monitor = Any()

    @Volatile
    private var snapshot = CloudSyncSnapshot(
        status = CloudStatus.UNKNOWN,
        lastAcknowledgement = null,
        message = "Cloud replication has not run in this native process."
    )

    fun currentSnapshot(): CloudSyncSnapshot = snapshot.copy(
        lastAcknowledgement = database.lastCloudAcknowledgement() ?: snapshot.lastAcknowledgement
    )

    fun syncOnce() = synchronized(monitor) {
        val bundle = activeBundle()
        if (bundle == null) {
            setSnapshot(CloudStatus.UNKNOWN, "Cloud replication is unavailable until the Hub is enrolled.")
            return@synchronized
        }
        if (!isConfigured()) {
            setSnapshot(CloudStatus.UNKNOWN, "Cloud replication endpoint is not configured for this build.")
            return@synchronized
        }
        val now = HubCloudTime.now()
        val recoveryMode = HubTime.isExpired(bundle.expiresAt, now)
        if (recoveryMode && !HubCloudTime.isWithinRecoveryWindow(bundle.expiresAt, now)) {
            setSnapshot(
                CloudStatus.DISCONNECTED,
                "Cloud replication recovery has expired. No new local command is permitted; retain the encrypted ledger for the approved forensic recovery path."
            )
            return@synchronized
        }

        val events = database.pendingCloudEvents(MAX_BATCH_EVENTS, bundle.hubDeviceId)
        if (events.isEmpty()) {
            val priorStatus = snapshot.status
            setSnapshot(
                if (priorStatus == CloudStatus.CONNECTED) CloudStatus.CONNECTED else CloudStatus.UNKNOWN,
                "No local events are queued; cloud reachability was not probed in this cycle."
            )
            return@synchronized
        }

        val submittedIds = events.map { it.optString("eventId", "") }.toSet()
        if (submittedIds.size != events.size || submittedIds.any { it.isBlank() }) {
            // This is a local ledger inconsistency, not a transport error. Do
            // not fabricate acknowledgements or silently skip records.
            database.recordCloudSyncFailure(submittedIds, "LOCAL_EVENT_ID_INVALID")
            setSnapshot(CloudStatus.DISCONNECTED, "Cloud replication stopped on an invalid local outbox record.")
            return@synchronized
        }

        try {
            val payloadEvents = JSONArray().apply {
                events.forEach { event -> put(event) }
            }
            val payloadBase64 = HubWireEncoding.encode(
                JSONObject().put("events", payloadEvents).toString().toByteArray(Charsets.UTF_8)
            )
            val requestId = UUID.randomUUID().toString()
            val issuedAt = HubCloudTime.now()
            val signature = signProtocol(
                HubCloudProtocol.syncRequestBytes(requestId, bundle.hubDeviceId, bundle.bundleId, issuedAt, payloadBase64)
            )
            val response = post("hub-sync", JSONObject()
                .put("requestId", requestId)
                .put("hubDeviceId", bundle.hubDeviceId)
                .put("bundleId", bundle.bundleId)
                .put("issuedAt", issuedAt)
                .put("payloadBase64", payloadBase64)
                .put("signature", signature)
            )
            val acknowledged = response.optJSONArray("acknowledgedEventIds")
                ?: throw HubUnavailableException("Cloud replication returned no acknowledgement list.")
            val acknowledgedIds = mutableSetOf<String>()
            for (index in 0 until acknowledged.length()) {
                val rawAcknowledgement = acknowledged.opt(index)
                if (rawAcknowledgement !is String) {
                    throw HubUnavailableException("Cloud replication returned an invalid acknowledgement.")
                }
                val eventId = rawAcknowledgement.trim()
                if (eventId.isBlank() || eventId !in submittedIds || eventId in acknowledgedIds) {
                    throw HubUnavailableException("Cloud replication returned an invalid acknowledgement.")
                }
                acknowledgedIds.add(eventId)
            }
            if (acknowledgedIds.isNotEmpty()) database.acknowledgeCloudEvents(acknowledgedIds, HubCloudTime.now())
            setSnapshot(
                CloudStatus.CONNECTED,
                if (acknowledgedIds.size == submittedIds.size) {
                    if (recoveryMode) {
                        "Cloud recovery durably acknowledged ${acknowledgedIds.size} pre-expiry local event(s)."
                    } else {
                        "Cloud receiver durably acknowledged ${acknowledgedIds.size} local event(s)."
                    }
                } else {
                    "Cloud receiver acknowledged ${acknowledgedIds.size} of ${submittedIds.size} local event(s); the remainder stay queued."
                }
            )
        } catch (_: Exception) {
            database.recordCloudSyncFailure(submittedIds, "CLOUD_SYNC_UNACKNOWLEDGED")
            setSnapshot(CloudStatus.DISCONNECTED, "Cloud receiver did not durably acknowledge the local event batch.")
        }
    }

    private fun setSnapshot(status: CloudStatus, message: String) {
        snapshot = CloudSyncSnapshot(status, database.lastCloudAcknowledgement(), message)
    }

    private fun isConfigured(): Boolean = BuildConfig.HUB_CLOUD_FUNCTIONS_BASE_URL.trim().startsWith("https://")

    private fun post(functionName: String, body: JSONObject): JSONObject {
        val base = BuildConfig.HUB_CLOUD_FUNCTIONS_BASE_URL.trim().removeSuffix("/")
        val connection = (URL("$base/$functionName").openConnection() as? HttpsURLConnection)
            ?: throw HubUnavailableException("Cloud receiver is unavailable.")
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { output -> output.write(body.toString()) }
            val status = connection.responseCode
            val response = readBounded(
                if (status in 200..299) connection.inputStream else connection.errorStream
                    ?: throw HubUnavailableException("Cloud receiver is unavailable.")
            )
            if (status !in 200..299) throw HubUnavailableException("Cloud receiver rejected the batch.")
            val parsed = try { JSONObject(response) } catch (_: Exception) {
                throw HubUnavailableException("Cloud receiver returned an invalid response.")
            }
            if (!parsed.optBoolean("ok", false)) throw HubUnavailableException("Cloud receiver rejected the batch.")
            return parsed
        } finally {
            connection.disconnect()
        }
    }

    private fun readBounded(stream: java.io.InputStream): String = stream.bufferedReader(Charsets.UTF_8).use { reader ->
        val buffer = CharArray(4096)
        val output = StringBuilder()
        while (true) {
            val count = reader.read(buffer)
            if (count < 0) break
            if (output.length + count > MAX_RESPONSE_CHARS) {
                throw HubUnavailableException("Cloud receiver response is too large.")
            }
            output.append(buffer, 0, count)
        }
        output.toString()
    }

    private companion object {
        const val MAX_BATCH_EVENTS = 100
        const val CONNECT_TIMEOUT_MS = 10_000
        const val READ_TIMEOUT_MS = 20_000
        const val MAX_RESPONSE_CHARS = 128 * 1024
    }
}

internal object HubCloudTime {
    fun now(): String = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
        timeZone = java.util.TimeZone.getTimeZone("UTC")
    }.format(java.util.Date())

    fun isWithinRecoveryWindow(expiresAt: String, now: String): Boolean {
        return try {
            HubTime.requireCanonicalUtc(expiresAt, "Authorization expiry")
            HubTime.requireCanonicalUtc(now, "Cloud recovery time")
            val formatter = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                isLenient = false
                timeZone = java.util.TimeZone.getTimeZone("UTC")
            }
            val expiry = formatter.parse(expiresAt)?.time
            val current = formatter.parse(now)?.time
            expiry != null && current != null && current - expiry <= RECOVERY_GRACE_MS
        } catch (_: Exception) {
            false
        }
    }

    private const val RECOVERY_GRACE_MS = 7L * 24L * 60L * 60L * 1000L
}
