package com.theplugos.cashierhub.native

import androidx.core.content.ContextCompat
import android.content.Intent
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.theplugos.cashierhub.ThePlugOSApplication
import org.json.JSONObject

/**
 * Narrow bridge between the React experience layer and the native Hub. Browser
 * calls can observe measured state or request a native-created command; they
 * cannot create a device identity, install an authorization bundle, provide a
 * staff session/sequence/signature, or mutate the device registry directly.
 */
@CapacitorPlugin(name = "ThePlugOSLocalHub")
class ThePlugOSLocalHubPlugin : Plugin() {
    private var removeObserver: (() -> Unit)? = null

    override fun load() {
        ContextCompat.startForegroundService(context, HubForegroundService.intent(context))
        removeObserver = runtime().addObserver { snapshot ->
            notifyListeners("hubStateChanged", toJs(snapshot))
        }
    }

    override fun handleOnDestroy() {
        removeObserver?.invoke()
        removeObserver = null
        super.handleOnDestroy()
    }

    @PluginMethod
    fun getSnapshot(call: PluginCall) {
        call.resolve(toJs(runtime().snapshot()))
    }

    @PluginMethod
    fun refresh(call: PluginCall) {
        call.resolve(toJs(runtime().snapshot()))
    }

    /** Returns only the non-secret signed operator/catalog view that is needed
     * to render a task UI. It cannot be used to reconstruct a session or sign
     * a command. */
    @PluginMethod
    fun getNativeOperatorContext(call: PluginCall) {
        try {
            call.resolve(operatorContextToJs(runtime().nativeOperatorContext()))
        } catch (error: IllegalStateException) {
            call.reject(error.message ?: "Native operator context is unavailable.")
        }
    }

    @PluginMethod
    fun submitCommand(call: PluginCall) {
        call.reject("Browser-provided signed command envelopes are not accepted. Request a native Hub command instead.")
    }

    /**
     * Receives only non-secret task input. The runtime obtains the active
     * native session, sequence, timestamp, and Keystore signature itself, so
     * none of those authority values enter JavaScript.
     */
    @PluginMethod
    fun submitNativeCommandRequest(call: PluginCall) {
        try {
            val commandId = call.getString("commandId")?.trim()
                ?: throw HubCommandRejectedException("A native command ID is required.")
            val type = call.getString("type")?.trim()
                ?: throw HubCommandRejectedException("A native command type is required.")
            val payload = call.getObject("payload")
                ?: throw HubCommandRejectedException("A native command payload is required.")
            call.resolve(receiptToJs(runtime().submitNativeCommandRequest(commandId, type, payload)))
        } catch (error: IllegalStateException) {
            call.reject(error.message ?: "The Hub rejected the command.")
        }
    }

    /** A recovery action, not an event mutation. Native code verifies that the
     * current staff session owns an intent and that no receipt exists before
     * removing its reservation. */
    @PluginMethod
    fun discardNativeCommandRequest(call: PluginCall) {
        try {
            val commandId = call.getString("commandId")?.trim()
                ?: throw HubCommandRejectedException("A native command ID is required.")
            call.resolve(JSObject().apply {
                put("discarded", runtime().discardNativeCommandRequest(commandId))
            })
        } catch (error: IllegalStateException) {
            call.reject(error.message ?: "The Hub could not abandon the command intent.")
        }
    }

    /** Ends the locally selected native staff session. No browser-supplied
     * staff/session identifier is accepted, and no committed Hub fact is
     * deleted by this non-operational action. */
    @PluginMethod
    fun endNativeStaffSession(call: PluginCall) {
        try {
            call.resolve(JSObject().apply {
                put("ended", runtime().endNativeStaffSession())
            })
        } catch (error: IllegalStateException) {
            call.reject(error.message ?: "The native staff session could not be ended.")
        }
    }

    /** Opens a native-only pairing-code surface. The browser passes no code,
     * key, certificate, or authority data into this activity. */
    @PluginMethod
    fun openNativeEnrollment(call: PluginCall) {
        try {
            activity.startActivity(Intent(activity, NativeHubEnrollmentActivity::class.java))
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (_: Exception) {
            call.reject("The native Hub enrollment screen could not be opened.")
        }
    }

    /** Opens the terminal-only code entry surface. Just like Hub enrollment,
     * the browser supplies no pairing code, device key, admission, or local
     * transport secret to native code. */
    @PluginMethod
    fun openNativeTerminalEnrollment(call: PluginCall) {
        try {
            activity.startActivity(Intent(activity, NativeTerminalEnrollmentActivity::class.java))
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (_: Exception) {
            call.reject("The native branch-terminal enrollment screen could not be opened.")
        }
    }

    /** Opens the measured terminal local-link screen. It has no browser
     * command or credential input; terminal identity is read only from the
     * Android Keystore-bound signed admission. */
    @PluginMethod
    fun openNativeTerminalLocalLink(call: PluginCall) {
        try {
            activity.startActivity(Intent(activity, NativeTerminalLocalLinkActivity::class.java))
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (_: Exception) {
            call.reject("The native terminal local-link screen could not be opened.")
        }
    }

    /** Opens the native PIN surface without returning a PIN or session bearer
     * through Capacitor. A later Hub snapshot reports measured state only. */
    @PluginMethod
    fun openNativeStaffSignIn(call: PluginCall) {
        try {
            activity.startActivity(Intent(activity, NativeStaffSignInActivity::class.java))
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (_: Exception) {
            call.reject("The native staff sign-in screen could not be opened.")
        }
    }

    /** Browser ownership can request only that the native recovery screen be
     * opened. It cannot pass a recovery code, staff target, PIN, or proof. */
    @PluginMethod
    fun openNativeStaffCredentialReset(call: PluginCall) {
        try {
            activity.startActivity(Intent(activity, NativeStaffCredentialResetActivity::class.java))
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (_: Exception) {
            call.reject("The native staff credential-reset screen could not be opened.")
        }
    }

    @PluginMethod
    fun discoverDevices(call: PluginCall) {
        call.reject("LAN discovery is unavailable until an enrolled Hub has started the verified TLS transport.")
    }

    @PluginMethod
    fun registerDevice(call: PluginCall) {
        call.reject("Browser-originated device authorization is retired. Start a server-verified native enrollment flow instead.")
    }

    @PluginMethod
    fun revokeDevice(call: PluginCall) {
        call.reject("Device revocation must be submitted as an authorized native command and acknowledged by cloud authority.")
    }

    private fun runtime(): CashierHubRuntime = (context.applicationContext as ThePlugOSApplication).cashierHubRuntime

    private fun toJs(snapshot: HubSnapshot): JSObject {
        val health = snapshot.health
        val root = JSObject()
        root.put("networkHealth", JSObject().apply {
            put("mode", health.mode)
            put("availability", health.availability.name)
            put("localPeerCount", health.localPeerCount)
            put("packetLossRate", health.packetLossRate)
            put("latencyMs", health.latencyMs)
            put("outboxDepth", health.outboxDepth)
            put("inboxDepth", health.inboxDepth)
            put("lastSyncTimestamp", health.lastSyncTimestamp)
            put("cloudConnected", health.cloudStatus == CloudStatus.CONNECTED)
            put("cloudStatus", health.cloudStatus.name)
            put("activeTransport", health.activeTransport)
            put("message", health.message)
        })
        root.put("devices", JSArray().apply { snapshot.devices.forEach { put(deviceToJs(it)) } })
        root.put("failures", JSArray())
        root.put("transportMetrics", JSArray())
        root.put("outbox", JSArray().apply { snapshot.outbox.forEach { put(it) } })
        root.put("inbox", JSArray().apply { snapshot.inbox.forEach { put(it) } })
        return root
    }

    private fun deviceToJs(device: HubDevice): JSObject = JSObject().apply {
        put("id", device.id)
        put("name", device.name)
        put("role", device.role)
        put("status", device.status)
        put("connectionType", device.connectionType)
        put("queuedEvents", device.queuedEvents)
        put("lastHeartbeat", device.lastHeartbeat)
        put("certFingerprint", device.certFingerprint)
        put("businessId", device.businessId)
        put("branchId", device.branchId)
        put("isHub", device.isHub)
    }

    private fun receiptToJs(receipt: HubReceipt): JSObject = JSObject().apply {
        put("commandId", receipt.commandId)
        put("outcome", receipt.outcome)
        put("committedAt", receipt.committedAt)
        put("eventIds", JSArray().apply { receipt.eventIds.forEach { put(it) } })
        put("outboxIds", JSArray().apply { receipt.outboxIds.forEach { put(it) } })
    }

    private fun operatorContextToJs(context: NativeOperatorContext): JSObject = JSObject().apply {
        put("staffName", context.staffName)
        put("role", context.role)
        put("vat", JSObject().apply {
            put("enabled", context.vatEnabled)
            put("rate", context.vatRate)
        })
        put("catalogProducts", JSArray().apply {
            context.catalogProducts.forEach { product ->
                put(JSObject().apply {
                    put("id", product.productId)
                    put("name", product.name)
                    put("category", product.category)
                    put("price", product.price)
                    put("stockQuantity", product.stockQuantity)
                    put("unit", product.unit)
                    put("status", product.status)
                })
            }
        })
        put("inventoryProducts", JSArray().apply {
            context.inventoryProducts.forEach { product ->
                put(JSObject().apply {
                    put("id", product.productId)
                    put("name", product.name)
                    put("stockQuantity", product.stockQuantity)
                    put("unit", product.unit)
                })
            }
        })
        put("activeCashShift", context.activeCashShift?.let { shift ->
            JSObject().apply {
                put("id", shift.shiftId)
                put("status", shift.status)
                put("openingFloat", shift.openingFloat)
                put("cashSalesTotal", shift.cashSalesTotal)
                put("cashTenderedTotal", shift.cashTenderedTotal)
                put("cashChangeTotal", shift.cashChangeTotal)
                put("expectedCash", shift.expectedCash)
            }
        })
        put("pendingCashOrders", JSArray().apply {
            context.pendingCashOrders.forEach { order ->
                put(JSObject().apply {
                    put("id", order.orderId)
                    put("status", order.status)
                    put("totalAmount", order.totalAmount)
                    put("paymentMethod", order.paymentMethod)
                })
            }
        })
        put("readyForCollectionOrders", JSArray().apply {
            context.readyForCollectionOrders.forEach { order ->
                put(JSObject().apply {
                    put("id", order.orderId)
                    put("status", order.status)
                })
            }
        })
        put("cancellableOrders", JSArray().apply {
            context.cancellableOrders.forEach { order ->
                put(JSObject().apply {
                    put("id", order.orderId)
                    put("status", order.status)
                })
            }
        })
        put("pendingKitchenOrders", JSArray().apply {
            context.pendingKitchenOrders.forEach { order ->
                put(JSObject().apply {
                    put("id", order.orderId)
                    put("status", order.status)
                    put("items", JSArray().apply {
                        order.items.forEach { item ->
                            put(JSObject().apply {
                                put("productId", item.productId)
                                put("name", item.name)
                                put("quantity", item.quantity)
                            })
                        }
                    })
                })
            }
        })
        put("recoverableNativeCommands", JSArray().apply {
            context.recoverableNativeCommands.forEach { command ->
                put(JSObject().apply {
                    put("commandId", command.commandId)
                    put("type", command.type)
                    put("payload", JSObject(command.payload.toString()))
                })
            }
        })
    }
}
