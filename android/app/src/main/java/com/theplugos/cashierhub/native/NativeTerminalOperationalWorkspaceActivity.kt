package com.theplugos.cashierhub.native

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID

/**
 * Native-only terminal task surface. It holds no browser bridge and does not
 * receive a session key, PIN, signed bundle, or device credential through an
 * Intent. It asks the authenticated Hub for a fresh role-minimized projection
 * and submits all work through TerminalOperationalCommandClient.
 */
class NativeTerminalOperationalWorkspaceActivity : Activity() {
    private lateinit var controller: TerminalLocalLinkController
    private lateinit var sessions: TerminalStaffSessionCoordinator
    private lateinit var commands: TerminalOperationalCommandClient
    private lateinit var status: TextView
    private lateinit var taskRoot: LinearLayout
    private lateinit var refresh: Button
    private val basket = linkedMapOf<String, Double>()
    private var context: NativeOperatorContext? = null
    private var contextRequestInFlight = false
    private var refreshAfterCurrentRequest = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val keys = TerminalKeyManager(applicationContext)
        sessions = TerminalStaffSessionCoordinator(keys)
        commands = TerminalOperationalCommandClient(keys, sessions)
        status = TextView(this).apply {
            text = "Checking the native terminal session and authenticated Hub link."
        }
        refresh = Button(this).apply { text = "Refresh measured task data" }
        val signOut = Button(this).apply { text = "End local terminal session" }
        val close = Button(this).apply { text = "Close" }
        taskRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 20, 36, 48)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(36, 64, 36, 28)
            addView(status, fullWidth())
            addView(refresh, fullWidth())
            addView(signOut, fullWidth())
            addView(taskRoot, fullWidth())
            addView(close, fullWidth())
        }
        setContentView(ScrollView(this).apply { addView(content) })

        controller = TerminalLocalLinkController(
            applicationContext,
            keys = keys,
            onSnapshot = ::onLinkSnapshot,
            onCommittedEvent = { requestContext(force = true) },
        )
        refresh.setOnClickListener { requestContext(force = true) }
        signOut.setOnClickListener {
            sessions.clearSession()
            basket.clear()
            context = null
            taskRoot.removeAllViews()
            renderSignInRequired("The local terminal session ended. Sign in again before requesting task data.")
        }
        close.setOnClickListener { finish() }
        controller.start()
    }

    override fun onDestroy() {
        if (::controller.isInitialized) controller.stop()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == SIGN_IN_REQUEST && resultCode == RESULT_OK) {
            controller.start()
            requestContext(force = true)
        }
    }

    private fun onLinkSnapshot(snapshot: TerminalLocalLinkSnapshot) {
        status.text = when (snapshot.state) {
            TerminalLocalLinkState.NOT_ENROLLED -> "A current signed terminal admission is required. ${snapshot.detail}"
            TerminalLocalLinkState.DISCOVERING -> "Discovering the admitted Hub. ${snapshot.detail}"
            TerminalLocalLinkState.PROXIMITY_SEEN -> "Bluetooth proximity measured. ${snapshot.detail}"
            TerminalLocalLinkState.ENDPOINT_RESOLVED -> "Local endpoint resolved. ${snapshot.detail}"
            TerminalLocalLinkState.TLS_PINNING -> "Verifying pinned Hub TLS. ${snapshot.detail}"
            TerminalLocalLinkState.CHALLENGED -> "Proving terminal identity. ${snapshot.detail}"
            TerminalLocalLinkState.AUTHENTICATED -> "Authenticated Hub link active. Checking native terminal session."
            TerminalLocalLinkState.STAFF_SESSION_ACTIVE -> "Verified ${context?.role?.replace('_', ' ') ?: "terminal"} task context active."
            TerminalLocalLinkState.UNAVAILABLE -> "Terminal workspace unavailable. ${snapshot.detail}"
        }
        if (snapshot.state in setOf(TerminalLocalLinkState.AUTHENTICATED, TerminalLocalLinkState.STAFF_SESSION_ACTIVE)) {
            requestContext()
        } else if (snapshot.state !in setOf(TerminalLocalLinkState.DISCOVERING, TerminalLocalLinkState.PROXIMITY_SEEN, TerminalLocalLinkState.ENDPOINT_RESOLVED, TerminalLocalLinkState.TLS_PINNING, TerminalLocalLinkState.CHALLENGED)) {
            context = null
            taskRoot.removeAllViews()
        }
    }

    private fun requestContext(force: Boolean = false) {
        if (!::controller.isInitialized || contextRequestInFlight) {
            if (force) refreshAfterCurrentRequest = true
            return
        }
        if (!force && context != null) return
        val session = sessions.currentSession()
        if (session == null) {
            context = null
            taskRoot.removeAllViews()
            renderSignInRequired("A fresh native terminal PIN sign-in is required before task data can be shown.")
            return
        }
        val linkState = controller.current().state
        if (linkState !in setOf(TerminalLocalLinkState.AUTHENTICATED, TerminalLocalLinkState.STAFF_SESSION_ACTIVE)) return
        contextRequestInFlight = true
        controller.requestTerminalOperatorContext(session.sessionId) { received, error ->
            contextRequestInFlight = false
            if (received == null || error != null) {
                context = null
                taskRoot.removeAllViews()
                status.text = error ?: "The Hub could not provide terminal task data."
                renderSignInRequired("Task data is unavailable until the terminal session and local link are verified.")
            } else {
                context = received
                normalizeBasket(received)
                renderContext(received)
            }
            if (refreshAfterCurrentRequest) {
                refreshAfterCurrentRequest = false
                requestContext(force = true)
            }
        }
    }

    private fun renderSignInRequired(detail: String) {
        taskRoot.addView(label(detail, 16))
        taskRoot.addView(action("Open native terminal sign-in") {
            startActivityForResult(Intent(this, NativeTerminalStaffSignInActivity::class.java), SIGN_IN_REQUEST)
        })
    }

    private fun renderContext(value: NativeOperatorContext) {
        taskRoot.removeAllViews()
        taskRoot.addView(label("${value.role.replace('_', ' ')} terminal — ${value.staffName}", 20))
        renderPendingRetry()
        when (value.role) {
            "CASHIER" -> renderCashier(value)
            "KITCHEN_STAFF" -> renderKitchen(value)
            "MANAGER" -> renderManager(value)
            else -> renderSignInRequired("The admitted terminal role is not supported by this release.")
        }
    }

    private fun renderPendingRetry() {
        val pending = sessions.currentSession()?.pendingCommand ?: return
        taskRoot.addView(label("One signed command is waiting for a measured receipt: ${pending.type}.", 15))
        taskRoot.addView(action("Retry pending ${pending.type.replace('.', ' ')}") {
            submitRetry(pending.commandId)
        })
    }

    private fun renderCashier(value: NativeOperatorContext) {
        taskRoot.addView(section("Cashier"))
        val shift = value.activeCashShift
        if (shift == null) {
            taskRoot.addView(label("A Manager must open the cash shift before this terminal can create an order.", 15))
        } else {
            taskRoot.addView(label("Open shift · expected cash ${money(shift.expectedCash)}", 15))
            renderCashierBasket(value)
        }

        taskRoot.addView(section("Pending cash orders"))
        if (value.pendingCashOrders.isEmpty()) {
            taskRoot.addView(label("No cash orders are awaiting capture.", 15))
        } else {
            value.pendingCashOrders.forEach { order ->
                taskRoot.addView(action("Capture ${money(order.totalAmount)} · ${shortId(order.orderId)}") {
                    promptMoney("Cash tendered", order.totalAmount) { tendered ->
                        submit("payment.capture", JSONObject()
                            .put("paymentId", UUID.randomUUID().toString())
                            .put("orderId", order.orderId)
                            .put("cashTendered", tendered)
                        )
                    }
                })
            }
        }

        taskRoot.addView(section("Collection"))
        if (value.readyForCollectionOrders.isEmpty()) {
            taskRoot.addView(label("No paid orders are ready for collection.", 15))
        } else {
            value.readyForCollectionOrders.forEach { order ->
                taskRoot.addView(action("Mark collected · ${shortId(order.orderId)}") {
                    submit("order.status.transition", JSONObject().put("orderId", order.orderId).put("status", "COLLECTED"))
                })
            }
        }
    }

    private fun renderCashierBasket(value: NativeOperatorContext) {
        taskRoot.addView(section("New cash order"))
        if (value.catalogProducts.isEmpty()) {
            taskRoot.addView(label("No active product is available in the measured Hub catalog.", 15))
            return
        }
        val products = value.catalogProducts
        val spinner = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@NativeTerminalOperationalWorkspaceActivity,
                android.R.layout.simple_spinner_dropdown_item,
                products.map { "${it.name} · ${money(it.price)} · stock ${quantity(it.stockQuantity)} ${it.unit}" }
            )
        }
        val quantityInput = quantityInput("Quantity", "1")
        taskRoot.addView(spinner, fullWidth())
        taskRoot.addView(quantityInput, fullWidth())
        taskRoot.addView(action("Add item") {
            val product = products.getOrNull(spinner.selectedItemPosition) ?: return@action
            val amount = readPositiveQuantity(quantityInput, "Enter a positive item quantity.") ?: return@action
            val prior = basket[product.productId] ?: 0.0
            if (prior + amount > product.stockQuantity + QUANTITY_EPSILON) {
                status.text = "The selected quantity exceeds the current measured stock for ${product.name}."
                return@action
            }
            basket[product.productId] = roundQuantity(prior + amount)
            renderContext(value)
        })

        if (basket.isEmpty()) {
            taskRoot.addView(label("No item has been added to this order.", 15))
            return
        }
        taskRoot.addView(section("Order basket"))
        val productById = products.associateBy { it.productId }
        basket.toMap().forEach { (productId, amount) ->
            val product = productById[productId] ?: return@forEach
            taskRoot.addView(action("Remove ${product.name} × ${quantity(amount)}") {
                basket.remove(productId)
                renderContext(value)
            })
        }
        val totals = orderTotals(value, productById)
        taskRoot.addView(label("Subtotal ${money(totals.subtotal)} · VAT ${money(totals.tax)} · Total ${money(totals.total)}", 16))
        taskRoot.addView(action("Create cash order · ${money(totals.total)}") {
            val payload = JSONObject()
                .put("orderId", UUID.randomUUID().toString())
                .put("items", JSONArray().apply {
                    basket.forEach { (productId, amount) ->
                        val product = productById[productId] ?: return@forEach
                        put(JSONObject().put("productId", product.productId).put("quantity", amount).put("price", product.price))
                    }
                })
                .put("subtotal", totals.subtotal)
                .put("tax", totals.tax)
                .put("totalAmount", totals.total)
                .put("paymentMethod", "CASH")
            submit("order.create", payload) { result ->
                if (result.outcome in setOf("APPLIED", "DUPLICATE")) basket.clear()
            }
        })
    }

    private fun renderKitchen(value: NativeOperatorContext) {
        taskRoot.addView(section("Kitchen queue"))
        if (value.pendingKitchenOrders.isEmpty()) {
            taskRoot.addView(label("No locally committed order is awaiting Kitchen work.", 15))
            return
        }
        value.pendingKitchenOrders.forEach { order ->
            taskRoot.addView(label("${shortId(order.orderId)} · ${order.status}", 17))
            order.items.forEach { item ->
                taskRoot.addView(label("• ${item.name} × ${quantity(item.quantity)}", 15))
            }
            val next = if (order.status == "PLACED") "PREPARING" else "READY"
            val title = if (next == "PREPARING") "Start preparation" else "Mark ready"
            taskRoot.addView(action("$title · ${shortId(order.orderId)}") {
                submit("order.status.transition", JSONObject().put("orderId", order.orderId).put("status", next))
            })
        }
    }

    private fun renderManager(value: NativeOperatorContext) {
        taskRoot.addView(section("Cash shift"))
        val shift = value.activeCashShift
        if (shift == null) {
            val openingFloat = moneyInput("Opening float", "0.00")
            taskRoot.addView(openingFloat, fullWidth())
            taskRoot.addView(action("Open cash shift") {
                val amount = readNonNegativeMoney(openingFloat, "Enter a valid opening float.") ?: return@action
                submit("shift.open", JSONObject().put("shiftId", UUID.randomUUID().toString()).put("openingFloat", amount))
            })
        } else {
            taskRoot.addView(label("Open shift · expected cash ${money(shift.expectedCash)}", 15))
            val counted = moneyInput("Counted cash", money(shift.expectedCash).removePrefix("R"))
            taskRoot.addView(counted, fullWidth())
            taskRoot.addView(action("Close cash shift") {
                val amount = readNonNegativeMoney(counted, "Enter a valid counted cash amount.") ?: return@action
                submit("shift.close", JSONObject().put("shiftId", shift.shiftId).put("countedCash", amount))
            })
        }

        taskRoot.addView(section("Unpaid order cancellation"))
        if (value.cancellableOrders.isEmpty()) {
            taskRoot.addView(label("No unpaid order can be cancelled by this Manager session.", 15))
        } else {
            value.cancellableOrders.forEach { order ->
                taskRoot.addView(action("Cancel ${order.status.lowercase()} order · ${shortId(order.orderId)}") {
                    submit("order.status.transition", JSONObject().put("orderId", order.orderId).put("status", "CANCELLED"))
                })
            }
        }

        renderManagerInventory(value)
    }

    private fun renderManagerInventory(value: NativeOperatorContext) {
        taskRoot.addView(section("Counted inventory"))
        if (value.inventoryProducts.isEmpty()) {
            taskRoot.addView(label("No active product is available for counted inventory work.", 15))
            return
        }
        val products = value.inventoryProducts
        val spinner = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@NativeTerminalOperationalWorkspaceActivity,
                android.R.layout.simple_spinner_dropdown_item,
                products.map { "${it.name} · ${quantity(it.stockQuantity)} ${it.unit}" }
            )
        }
        val quantity = quantityInput("Quantity / counted final balance", "1")
        val wasteReason = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@NativeTerminalOperationalWorkspaceActivity,
                android.R.layout.simple_spinner_dropdown_item,
                listOf("SPOILAGE", "DAMAGE", "EXPIRED")
            )
        }
        taskRoot.addView(spinner, fullWidth())
        taskRoot.addView(quantity, fullWidth())
        taskRoot.addView(action("Record receipt") {
            val selected = products.getOrNull(spinner.selectedItemPosition) ?: return@action
            val amount = readPositiveQuantity(quantity, "Enter a positive received quantity.") ?: return@action
            submit("inventory.receive", JSONObject()
                .put("receiptId", UUID.randomUUID().toString())
                .put("items", JSONArray().put(JSONObject().put("productId", selected.productId).put("quantity", amount)))
            )
        })
        taskRoot.addView(action("Record count correction") {
            val selected = products.getOrNull(spinner.selectedItemPosition) ?: return@action
            val amount = readNonNegativeQuantity(quantity, "Enter a non-negative counted final balance.") ?: return@action
            submit("inventory.adjust", JSONObject()
                .put("adjustmentId", UUID.randomUUID().toString())
                .put("reason", "COUNT_CORRECTION")
                .put("items", JSONArray().put(JSONObject().put("productId", selected.productId).put("stockAfter", amount)))
            )
        })
        taskRoot.addView(wasteReason, fullWidth())
        taskRoot.addView(action("Record physical waste") {
            val selected = products.getOrNull(spinner.selectedItemPosition) ?: return@action
            val amount = readPositiveQuantity(quantity, "Enter a positive physical waste quantity.") ?: return@action
            val reason = wasteReason.selectedItem?.toString() ?: return@action
            submit("inventory.waste", JSONObject()
                .put("wasteId", UUID.randomUUID().toString())
                .put("reason", reason)
                .put("items", JSONArray().put(JSONObject().put("productId", selected.productId).put("quantity", amount)))
            )
        })
    }

    private fun submit(type: String, payload: JSONObject, onFinal: (TerminalOperationalCommandResult) -> Unit = {}) {
        status.text = "Submitting a signed $type command to the authenticated Hub…"
        try {
            commands.submit(controller, UUID.randomUUID().toString(), type, payload) { result ->
                status.text = when (result.outcome) {
                    "APPLIED" -> "Local command committed. Cloud delivery is measured separately."
                    "DUPLICATE" -> "The Hub returned the original local command receipt."
                    "REJECTED" -> result.error ?: "The Hub rejected the command without a local effect."
                    else -> result.error ?: "The signed command is retained for an exact retry when the Hub is available."
                }
                onFinal(result)
                if (result.outcome in setOf("APPLIED", "DUPLICATE")) requestContext(force = true)
            }
        } catch (error: IllegalStateException) {
            status.text = error.message ?: "The terminal command could not be prepared."
        }
    }

    private fun submitRetry(commandId: String) {
        status.text = "Retrying the exact saved signed command…"
        try {
            commands.retryPending(controller, commandId) { result ->
                status.text = if (result.outcome in setOf("APPLIED", "DUPLICATE")) {
                    "The saved command now has a measured Hub receipt."
                } else {
                    result.error ?: "The saved command remains pending."
                }
                if (result.outcome in setOf("APPLIED", "DUPLICATE")) requestContext(force = true)
            }
        } catch (error: IllegalStateException) {
            status.text = error.message ?: "The saved command could not be retried."
        }
    }

    private fun promptMoney(title: String, defaultValue: Double, onValue: (Double) -> Unit) {
        val input = moneyInput(title, money(defaultValue).removePrefix("R"))
        AlertDialog.Builder(this)
            .setTitle(title)
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Continue") { _, _ ->
                readNonNegativeMoney(input, "Enter a valid cash amount.")?.let(onValue)
            }
            .show()
    }

    private fun normalizeBasket(value: NativeOperatorContext) {
        val products = value.catalogProducts.associateBy { it.productId }
        basket.keys.toList().forEach { productId ->
            val product = products[productId]
            val amount = basket[productId] ?: 0.0
            if (product == null || amount <= 0.0 || amount > product.stockQuantity + QUANTITY_EPSILON) {
                basket.remove(productId)
            }
        }
    }

    private fun orderTotals(value: NativeOperatorContext, products: Map<String, NativeCatalogProduct>): OrderTotals {
        val subtotal = basket.entries.fold(0.0) { total, (productId, amount) ->
            val product = products[productId]
            if (product == null) total else roundMoney(total + roundMoney(product.price * amount))
        }
        val tax = if (value.vatEnabled) roundMoney(subtotal * value.vatRate / 100.0) else 0.0
        return OrderTotals(subtotal, tax, roundMoney(subtotal + tax))
    }

    private fun quantityInput(hint: String, value: String): EditText = EditText(this).apply {
        this.hint = hint
        setText(value)
        inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
    }

    private fun moneyInput(hint: String, value: String): EditText = quantityInput(hint, value)

    private fun readPositiveQuantity(input: EditText, message: String): Double? =
        readNonNegativeQuantity(input, message)?.takeIf { it > 0.0 } ?: run {
            status.text = message
            null
        }

    private fun readNonNegativeQuantity(input: EditText, message: String): Double? {
        val value = input.text?.toString()?.trim()?.toDoubleOrNull()
        if (value == null || !value.isFinite() || value < 0.0 || value > MAX_STOCK ||
            kotlin.math.abs(value - roundQuantity(value)) > QUANTITY_EPSILON
        ) {
            status.text = message
            return null
        }
        return roundQuantity(value)
    }

    private fun readNonNegativeMoney(input: EditText, message: String): Double? {
        val value = input.text?.toString()?.trim()?.toDoubleOrNull()
        if (value == null || !value.isFinite() || value < 0.0 || value > MAX_MONEY ||
            kotlin.math.abs(value - roundMoney(value)) > MONEY_EPSILON
        ) {
            status.text = message
            return null
        }
        return roundMoney(value)
    }

    private fun section(text: String): TextView = label(text, 18).apply { setPadding(0, 30, 0, 8) }

    private fun label(text: String, size: Int): TextView = TextView(this).apply {
        this.text = text
        textSize = size.toFloat()
        setPadding(0, 8, 0, 8)
    }

    private fun action(text: String, block: () -> Unit): Button = Button(this).apply {
        this.text = text
        setOnClickListener { block() }
    }

    private fun fullWidth(): LinearLayout.LayoutParams = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
    )

    private fun money(value: Double): String = String.format(Locale.US, "R%.2f", value)
    private fun quantity(value: Double): String = String.format(Locale.US, "%.3f", value).trimEnd('0').trimEnd('.')
    private fun shortId(value: String): String = value.take(8)
    private fun roundMoney(value: Double): Double = Math.round(value * 100.0) / 100.0
    private fun roundQuantity(value: Double): Double = Math.round(value * 1_000.0) / 1_000.0

    private data class OrderTotals(val subtotal: Double, val tax: Double, val total: Double)

    private companion object {
        const val SIGN_IN_REQUEST = 481
        const val MAX_MONEY = 999_999_999.99
        const val MAX_STOCK = 99_999_999_999.999
        const val MONEY_EPSILON = 0.000_001
        const val QUANTITY_EPSILON = 0.000_001
    }
}
