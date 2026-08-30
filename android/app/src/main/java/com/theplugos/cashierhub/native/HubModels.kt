package com.theplugos.cashierhub.native

import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

enum class HubAvailability { READY, UNAVAILABLE, ERROR }
enum class CloudStatus { CONNECTED, DISCONNECTED, UNKNOWN }

data class HubHealth(
    val mode: String,
    val availability: HubAvailability,
    val localPeerCount: Int,
    val packetLossRate: Double?,
    val latencyMs: Double?,
    val outboxDepth: Int,
    val inboxDepth: Int,
    val lastSyncTimestamp: String?,
    val cloudStatus: CloudStatus,
    val activeTransport: String,
    val message: String
)

data class HubDevice(
    val id: String,
    val name: String,
    val role: String,
    val status: String,
    val connectionType: String,
    val queuedEvents: Int,
    val lastHeartbeat: String? = null,
    val certFingerprint: String? = null,
    val branchId: String? = null,
    val businessId: String? = null,
    val isHub: Boolean = false
)

data class HubSnapshot(
    val health: HubHealth,
    val devices: List<HubDevice> = emptyList(),
    val outbox: List<JSONObject> = emptyList(),
    val inbox: List<JSONObject> = emptyList()
)

data class OperationalCommand(
    val commandId: String,
    val type: String,
    val issuedAt: String,
    val deviceId: String,
    val staffSessionId: String,
    val sequence: Long,
    val payloadBase64: String,
    val payload: JSONObject,
    val signature: String
) {
    fun canonicalBytes(): ByteArray {
        val value = listOf(
            commandId,
            type,
            issuedAt,
            deviceId,
            staffSessionId,
            sequence.toString(),
            payloadBase64
        ).joinToString("\u001F")
        return value.toByteArray(Charsets.UTF_8)
    }

    /**
     * Stored with a receipt so a commandId collision cannot be mistaken for a
     * legitimate retry. The device signature is still verified separately;
     * this digest only binds the immutable envelope to its idempotency key.
     */
    fun fingerprint(): String = MessageDigest.getInstance("SHA-256")
        .digest(canonicalBytes())
        .joinToString(separator = "") { byte -> "%02x".format(byte) }

    companion object {
        fun fromJson(value: JSONObject): OperationalCommand {
            val issuedAt = value.requiredString("issuedAt")
            HubTime.requireCanonicalUtc(issuedAt, "Command issuedAt")
            return OperationalCommand(
                commandId = value.requiredUuid("commandId", "Command ID"),
                type = value.requiredString("type"),
                issuedAt = issuedAt,
                deviceId = value.requiredString("deviceId"),
                staffSessionId = value.requiredUuid("staffSessionId", "Staff session ID"),
                sequence = value.requiredLong("sequence"),
                payloadBase64 = value.requiredString("payloadBase64"),
                payload = value.requiredPayload("payloadBase64"),
                signature = value.requiredString("signature")
            )
        }
    }
}

data class VerifiedCommandContext(
    val businessId: String,
    val branchId: String,
    val deviceId: String,
    val staffId: String,
    val staffSessionId: String,
    val role: String,
    val authorizationBundleId: String,
    val revocationVersion: Long
)

/**
 * Public certificate binding carried inside a cloud-signed authorization
 * bundle. It contains no TLS private key: the matching certificate's private
 * key remains non-exportable in Android Keystore.
 */
data class LocalTlsBinding(val hubTlsCertificateSha256: String) {
    companion object {
        fun fromJson(value: String?): LocalTlsBinding {
            if (value.isNullOrBlank()) throw HubCommandRejectedException("The authorization bundle has no Hub TLS certificate binding.")
            val fingerprint = JSONObject(value).optString("hubTlsCertificateSha256", "").trim().lowercase()
            if (!fingerprint.matches(Regex("^[0-9a-f]{64}$"))) {
                throw HubCommandRejectedException("The authorization bundle has an invalid Hub TLS certificate binding.")
            }
            return LocalTlsBinding(fingerprint)
        }
    }
}

data class HubEventDraft(
    val aggregateId: String,
    val aggregateType: String,
    val action: String,
    val payload: JSONObject,
    val schemaVersion: Int = 1
)

data class HubEvent(
    val eventId: String,
    val commandId: String,
    val aggregateId: String,
    val aggregateType: String,
    val action: String,
    val businessId: String,
    val branchId: String,
    val deviceId: String,
    val staffId: String,
    val staffSessionId: String,
    val sequence: Long,
    val occurredAt: String,
    val schemaVersion: Int,
    val payload: JSONObject
)

data class ProjectionWrite(val name: String, val key: String, val value: JSONObject)

data class HubReceipt(
    val commandId: String,
    val businessId: String,
    val branchId: String,
    val deviceId: String,
    val staffSessionId: String,
    val type: String,
    val sequence: Long,
    val outcome: String,
    val committedAt: String,
    val eventIds: List<String>,
    val outboxIds: List<String>
)

/**
 * Durable native-only intent used to make a Capacitor request retryable
 * without ever exposing a device key, signature, session selector, or
 * sequence to JavaScript.
 */
data class NativeCommandIntent(
    val commandId: String,
    val deviceId: String,
    val staffSessionId: String,
    val type: String,
    val issuedAt: String,
    val sequence: Long,
    val payloadBase64: String,
    val payload: JSONObject
)

/** Non-secret signed facts that an enrolled React station may render after a
 * native PIN session is active. It deliberately omits staff/device/session
 * identifiers, authorization payloads, and any credential material. */
data class NativeOperatorContext(
    val staffName: String,
    val role: String,
    val vatEnabled: Boolean,
    val vatRate: Double,
    val catalogProducts: List<NativeCatalogProduct>,
    val inventoryProducts: List<NativeInventoryProduct>,
    val activeCashShift: NativeCashShift?,
    val pendingCashOrders: List<NativePendingCashOrder>,
    val readyForCollectionOrders: List<NativeReadyForCollectionOrder>,
    val cancellableOrders: List<NativeCancellableOrder>,
    val pendingKitchenOrders: List<NativeKitchenOrder>,
    val recoverableNativeCommands: List<NativeRecoverableCommand>
)

data class NativeCatalogProduct(
    val productId: String,
    val name: String,
    val category: String,
    val price: Double,
    val stockQuantity: Double,
    val unit: String,
    val status: String
)

/** A Manager inventory-receipt task exposes the minimum signed stock facts
 * needed to record a counted delivery. It intentionally omits price, tax,
 * cost, supplier, purchase-order, and financial data. */
data class NativeInventoryProduct(
    val productId: String,
    val name: String,
    val stockQuantity: Double,
    val unit: String
)

/** Non-secret, measured cash-drawer facts. These values are projections of
 * committed Hub events, never browser-entered balances. */
data class NativeCashShift(
    val shiftId: String,
    val status: String,
    val openingFloat: Double,
    val cashSalesTotal: Double,
    val cashTenderedTotal: Double,
    val cashChangeTotal: Double,
    val expectedCash: Double
)

/** A Cashier may see only their own locally committed cash orders that still
 * need capture. It deliberately exposes no staff/session/device identifiers. */
data class NativePendingCashOrder(
    val orderId: String,
    val status: String,
    val totalAmount: Double,
    val paymentMethod: String
)

/** A Cashier collection task is deliberately non-financial: the Hub already
 * proved the captured payment state before this bounded projection is shown. */
data class NativeReadyForCollectionOrder(
    val orderId: String,
    val status: String
)

/** A Manager cancellation task intentionally exposes only the order identity
 * and preparation state; money, tender, customer, and staff facts remain in
 * the Hub ledger and are never rendered as cancellation authority. */
data class NativeCancellableOrder(
    val orderId: String,
    val status: String
)

/** A Kitchen session sees only locally committed, branch-scoped preparation
 * facts. Payment, customer, cashier, staff-session, and device data are not
 * part of this task projection. */
data class NativeKitchenOrder(
    val orderId: String,
    val status: String,
    val items: List<NativeKitchenOrderLine>
)

data class NativeKitchenOrderLine(
    val productId: String,
    val name: String,
    val quantity: Double
)

/** A non-secret task request reserved by the Hub before signing, with no
 * receipt yet. It lets the current native staff session recover an interrupted
 * UI response without guessing whether a business effect was committed. */
data class NativeRecoverableCommand(
    val commandId: String,
    val type: String,
    val payload: JSONObject
)

/** Every command path rejects secret-bearing objects before they can become a
 * local intent, event, projection, audit fact, or cloud payload. */
object HubPayloadSafety {
    private val sensitiveFieldNames = setOf(
        "pin", "password", "passwordhash", "token", "accesstoken",
        "refreshtoken", "credential", "privatekey"
    )

    fun rejectSensitiveValues(value: Any?) {
        when (value) {
            is JSONObject -> value.keys().forEach { key ->
                if (key.lowercase() in sensitiveFieldNames) {
                    throw HubCommandRejectedException("Operational commands must not contain $key.")
                }
                rejectSensitiveValues(value.opt(key))
            }
            is org.json.JSONArray -> for (index in 0 until value.length()) rejectSensitiveValues(value.opt(index))
        }
    }
}

class HubCommandRejectedException(message: String) : IllegalStateException(message)
class HubUnavailableException(message: String) : IllegalStateException(message)

/**
 * All offline authorization timestamps use one fixed UTC representation. This
 * avoids the unsafe lexical comparisons that arise when an ISO timestamp may
 * omit milliseconds or use an offset other than Z.
 */
object HubTime {
    private val utcTimestamp = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")

    fun requireCanonicalUtc(value: String, subject: String) {
        if (!utcTimestamp.matches(value)) throw HubCommandRejectedException("$subject must use canonical UTC millisecond format.")
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val parsed = formatter.parse(value)
            ?: throw HubCommandRejectedException("$subject is not a valid UTC timestamp.")
        if (formatter.format(parsed) != value) throw HubCommandRejectedException("$subject is not a valid canonical UTC timestamp.")
    }

    fun isExpired(expiresAt: String, now: String): Boolean {
        requireCanonicalUtc(expiresAt, "Authorization expiry")
        requireCanonicalUtc(now, "Current Hub time")
        return expiresAt <= now
    }

    /** Canonical UTC arithmetic for bounded protocol clock-skew checks. */
    fun addMilliseconds(value: String, milliseconds: Long): String {
        requireCanonicalUtc(value, "Authorization time")
        require(milliseconds >= 0L) { "Authorization clock-skew bound is invalid." }
        val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            isLenient = false
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val parsed = formatter.parse(value)
            ?: throw HubCommandRejectedException("Authorization time is invalid.")
        return formatter.format(java.util.Date(Math.addExact(parsed.time, milliseconds)))
    }
}

private fun JSONObject.requiredString(name: String): String {
    val value = optString(name, "").trim()
    if (value.isEmpty()) throw HubCommandRejectedException("Command field $name is required.")
    return value
}

private fun JSONObject.requiredLong(name: String): Long {
    if (!has(name)) throw HubCommandRejectedException("Command field $name is required.")
    val value = optLong(name, -1L)
    if (value < 0L) throw HubCommandRejectedException("Command field $name must be a non-negative integer.")
    return value
}

private fun JSONObject.requiredUuid(name: String, subject: String): String {
    val value = requiredString(name)
    try {
        UUID.fromString(value)
    } catch (_: IllegalArgumentException) {
        throw HubCommandRejectedException("$subject must be a UUID.")
    }
    return value
}

private fun JSONObject.requiredPayload(name: String): JSONObject {
    val encoded = requiredString(name)
    if (encoded.length > MAX_COMMAND_PAYLOAD_BASE64_CHARS) {
        throw HubCommandRejectedException("Command payload exceeds the supported local command size.")
    }
    val bytes = HubWireEncoding.decode(encoded, "Command payloadBase64")
    if (bytes.isEmpty() || bytes.size > MAX_COMMAND_PAYLOAD_BYTES) {
        throw HubCommandRejectedException("Command payload exceeds the supported local command size.")
    }
    return try {
        JSONObject(String(bytes, Charsets.UTF_8))
    } catch (_: Exception) {
        throw HubCommandRejectedException("Command payloadBase64 must decode to a JSON object.")
    }
}

private const val MAX_COMMAND_PAYLOAD_BYTES = 64 * 1024
private const val MAX_COMMAND_PAYLOAD_BASE64_CHARS = 88 * 1024
