package com.theplugos.cashierhub.native

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Wire representation of the Hub-generated, role-minimized terminal task
 * projection. It deliberately contains no session bearer, key, PIN, device
 * proof, bundle, or cloud credential. The Hub generates it only after the
 * WebSocket's fresh device challenge and the R014 terminal session check.
 */
object TerminalOperatorContextWire {
    fun encode(context: NativeOperatorContext): JSONObject {
        if (context.role !in TERMINAL_ROLES) {
            throw HubCommandRejectedException("The terminal operator role is invalid.")
        }
        val value = JSONObject()
            .put("schemaVersion", SCHEMA_VERSION)
            .put("staffName", context.staffName)
            .put("role", context.role)
            .put("vat", JSONObject().put("enabled", context.vatEnabled).put("rate", context.vatRate))
            .put("catalogProducts", JSONArray().apply {
                context.catalogProducts.forEach { product ->
                    put(
                        JSONObject()
                            .put("id", product.productId)
                            .put("name", product.name)
                            .put("category", product.category)
                            .put("price", product.price)
                            .put("stockQuantity", product.stockQuantity)
                            .put("unit", product.unit)
                            .put("status", product.status)
                    )
                }
            })
            .put("inventoryProducts", JSONArray().apply {
                context.inventoryProducts.forEach { product ->
                    put(
                        JSONObject()
                            .put("id", product.productId)
                            .put("name", product.name)
                            .put("stockQuantity", product.stockQuantity)
                            .put("unit", product.unit)
                    )
                }
            })
            .put("activeCashShift", context.activeCashShift?.let { shift ->
                JSONObject()
                    .put("id", shift.shiftId)
                    .put("status", shift.status)
                    .put("openingFloat", shift.openingFloat)
                    .put("cashSalesTotal", shift.cashSalesTotal)
                    .put("cashTenderedTotal", shift.cashTenderedTotal)
                    .put("cashChangeTotal", shift.cashChangeTotal)
                    .put("expectedCash", shift.expectedCash)
            } ?: JSONObject.NULL)
            .put("pendingCashOrders", JSONArray().apply {
                context.pendingCashOrders.forEach { order ->
                    put(
                        JSONObject()
                            .put("id", order.orderId)
                            .put("status", order.status)
                            .put("totalAmount", order.totalAmount)
                            .put("paymentMethod", order.paymentMethod)
                    )
                }
            })
            .put("readyForCollectionOrders", JSONArray().apply {
                context.readyForCollectionOrders.forEach { order ->
                    put(JSONObject().put("id", order.orderId).put("status", order.status))
                }
            })
            .put("cancellableOrders", JSONArray().apply {
                context.cancellableOrders.forEach { order ->
                    put(JSONObject().put("id", order.orderId).put("status", order.status))
                }
            })
            .put("pendingKitchenOrders", JSONArray().apply {
                context.pendingKitchenOrders.forEach { order ->
                    put(
                        JSONObject()
                            .put("id", order.orderId)
                            .put("status", order.status)
                            .put("items", JSONArray().apply {
                                order.items.forEach { item ->
                                    put(
                                        JSONObject()
                                            .put("productId", item.productId)
                                            .put("name", item.name)
                                            .put("quantity", item.quantity)
                                    )
                                }
                            })
                    )
                }
            })
        HubPayloadSafety.rejectSensitiveValues(value)
        return value
    }

    /** Terminal-side parser. It treats an unexpected field, cross-role
     * projection, malformed quantity, or secret-named field as a protocol
     * failure rather than rendering an untrusted task view. */
    fun decode(value: JSONObject, expectedRole: String): NativeOperatorContext {
        if (value.toString().length > MAX_CONTEXT_CHARS) {
            throw HubCommandRejectedException("The terminal operator context is too large.")
        }
        if (expectedRole !in TERMINAL_ROLES) {
            throw HubCommandRejectedException("The terminal admission role is invalid.")
        }
        HubPayloadSafety.rejectSensitiveValues(value)
        value.requireExactTerminalContextKeys(ROOT_KEYS, "Terminal operator context")
        if (value.optInt("schemaVersion", -1) != SCHEMA_VERSION) {
            throw HubCommandRejectedException("The terminal operator context schema is not supported.")
        }
        val role = value.requiredTerminalContextText("role", "Terminal operator role", 32)
        if (role != expectedRole || role !in TERMINAL_ROLES) {
            throw HubCommandRejectedException("The terminal operator context does not match the admitted role.")
        }
        val staffName = value.requiredTerminalContextText("staffName", "Terminal operator name", MAX_NAME_CHARS)
        val vat = value.requiredTerminalContextObject("vat", "Terminal VAT context")
        vat.requireExactTerminalContextKeys(setOf("enabled", "rate"), "Terminal VAT context")
        val vatEnabled = vat.requiredTerminalContextBoolean("enabled", "Terminal VAT context")
        val vatRate = vat.requiredTerminalContextMoney("rate", "Terminal VAT rate", MAX_VAT_RATE)

        val seenCatalogProductIds = mutableSetOf<String>()
        val catalogProducts = value.requiredTerminalContextArray("catalogProducts", "Terminal catalog")
            .readTerminalContextArray(MAX_PRODUCTS, "Terminal catalog") { product ->
                product.requireExactTerminalContextKeys(
                    setOf("id", "name", "category", "price", "stockQuantity", "unit", "status"),
                    "Terminal catalog product"
                )
                val status = product.requiredTerminalContextText("status", "Terminal catalog status", 16)
                if (status != "ACTIVE") throw HubCommandRejectedException("Terminal catalog contains a non-active product.")
                val productId = product.requiredTerminalContextUuid("id", "Terminal catalog product ID")
                if (!seenCatalogProductIds.add(productId)) {
                    throw HubCommandRejectedException("Terminal catalog has duplicate products.")
                }
                NativeCatalogProduct(
                    productId = productId,
                    name = product.requiredTerminalContextText("name", "Terminal catalog product name", MAX_NAME_CHARS),
                    category = product.requiredTerminalContextText("category", "Terminal catalog product category", MAX_CATEGORY_CHARS),
                    price = product.requiredTerminalContextMoney("price", "Terminal catalog product price", MAX_MONEY),
                    stockQuantity = product.requiredTerminalContextQuantity("stockQuantity", "Terminal catalog product stock"),
                    unit = product.requiredTerminalContextText("unit", "Terminal catalog product unit", MAX_UNIT_CHARS),
                    status = status,
                )
            }

        val seenInventoryProductIds = mutableSetOf<String>()
        val inventoryProducts = value.requiredTerminalContextArray("inventoryProducts", "Terminal inventory")
            .readTerminalContextArray(MAX_PRODUCTS, "Terminal inventory") { product ->
                product.requireExactTerminalContextKeys(setOf("id", "name", "stockQuantity", "unit"), "Terminal inventory product")
                val productId = product.requiredTerminalContextUuid("id", "Terminal inventory product ID")
                if (!seenInventoryProductIds.add(productId)) {
                    throw HubCommandRejectedException("Terminal inventory has duplicate products.")
                }
                NativeInventoryProduct(
                    productId = productId,
                    name = product.requiredTerminalContextText("name", "Terminal inventory product name", MAX_NAME_CHARS),
                    stockQuantity = product.requiredTerminalContextQuantity("stockQuantity", "Terminal inventory stock"),
                    unit = product.requiredTerminalContextText("unit", "Terminal inventory unit", MAX_UNIT_CHARS),
                )
            }

        val activeCashShift = value.nullableTerminalContextObject("activeCashShift", "Terminal cash shift")?.let { shift ->
            shift.requireExactTerminalContextKeys(
                setOf("id", "status", "openingFloat", "cashSalesTotal", "cashTenderedTotal", "cashChangeTotal", "expectedCash"),
                "Terminal cash shift"
            )
            val status = shift.requiredTerminalContextText("status", "Terminal cash-shift status", 16)
            if (status != "OPEN") throw HubCommandRejectedException("Terminal cash-shift status is invalid.")
            NativeCashShift(
                shiftId = shift.requiredTerminalContextUuid("id", "Terminal cash-shift ID"),
                status = status,
                openingFloat = shift.requiredTerminalContextMoney("openingFloat", "Terminal cash opening float", MAX_MONEY),
                cashSalesTotal = shift.requiredTerminalContextMoney("cashSalesTotal", "Terminal cash sales total", MAX_MONEY),
                cashTenderedTotal = shift.requiredTerminalContextMoney("cashTenderedTotal", "Terminal cash tendered total", MAX_MONEY),
                cashChangeTotal = shift.requiredTerminalContextMoney("cashChangeTotal", "Terminal cash change total", MAX_MONEY),
                expectedCash = shift.requiredTerminalContextMoney("expectedCash", "Terminal expected cash", MAX_MONEY),
            )
        }

        val seenPendingCashOrderIds = mutableSetOf<String>()
        val pendingCashOrders = value.requiredTerminalContextArray("pendingCashOrders", "Terminal pending cash orders")
            .readTerminalContextArray(MAX_ORDERS, "Terminal pending cash orders") { order ->
                order.requireExactTerminalContextKeys(setOf("id", "status", "totalAmount", "paymentMethod"), "Terminal pending cash order")
                val status = order.requiredTerminalContextText("status", "Terminal pending cash-order status", 16)
                val paymentMethod = order.requiredTerminalContextText("paymentMethod", "Terminal pending cash-order method", 32)
                if (status !in CASH_PENDING_STATUSES || paymentMethod != "CASH") {
                    throw HubCommandRejectedException("Terminal pending cash order is invalid.")
                }
                val orderId = order.requiredTerminalContextUuid("id", "Terminal pending cash-order ID")
                if (!seenPendingCashOrderIds.add(orderId)) {
                    throw HubCommandRejectedException("Terminal pending cash orders have duplicate IDs.")
                }
                NativePendingCashOrder(
                    orderId = orderId,
                    status = status,
                    totalAmount = order.requiredTerminalContextMoney("totalAmount", "Terminal pending cash-order total", MAX_MONEY),
                    paymentMethod = paymentMethod,
                )
            }

        val seenCollectionOrderIds = mutableSetOf<String>()
        val readyForCollectionOrders = value.requiredTerminalContextArray("readyForCollectionOrders", "Terminal collection orders")
            .readTerminalContextArray(MAX_ORDERS, "Terminal collection orders") { order ->
                order.requireExactTerminalContextKeys(setOf("id", "status"), "Terminal collection order")
                if (order.requiredTerminalContextText("status", "Terminal collection status", 16) != "READY") {
                    throw HubCommandRejectedException("Terminal collection order is invalid.")
                }
                val orderId = order.requiredTerminalContextUuid("id", "Terminal collection order ID")
                if (!seenCollectionOrderIds.add(orderId)) {
                    throw HubCommandRejectedException("Terminal collection orders have duplicate IDs.")
                }
                NativeReadyForCollectionOrder(
                    orderId = orderId,
                    status = "READY",
                )
            }

        val seenCancellableOrderIds = mutableSetOf<String>()
        val cancellableOrders = value.requiredTerminalContextArray("cancellableOrders", "Terminal cancellable orders")
            .readTerminalContextArray(MAX_ORDERS, "Terminal cancellable orders") { order ->
                order.requireExactTerminalContextKeys(setOf("id", "status"), "Terminal cancellable order")
                val status = order.requiredTerminalContextText("status", "Terminal cancellable status", 16)
                if (status !in MANAGER_CANCELLABLE_STATUSES) throw HubCommandRejectedException("Terminal cancellable order is invalid.")
                val orderId = order.requiredTerminalContextUuid("id", "Terminal cancellable order ID")
                if (!seenCancellableOrderIds.add(orderId)) {
                    throw HubCommandRejectedException("Terminal cancellable orders have duplicate IDs.")
                }
                NativeCancellableOrder(
                    orderId = orderId,
                    status = status,
                )
            }

        val seenKitchenOrderIds = mutableSetOf<String>()
        val pendingKitchenOrders = value.requiredTerminalContextArray("pendingKitchenOrders", "Terminal Kitchen orders")
            .readTerminalContextArray(MAX_ORDERS, "Terminal Kitchen orders") { order ->
                order.requireExactTerminalContextKeys(setOf("id", "status", "items"), "Terminal Kitchen order")
                val status = order.requiredTerminalContextText("status", "Terminal Kitchen status", 16)
                if (status !in KITCHEN_PENDING_STATUSES) throw HubCommandRejectedException("Terminal Kitchen order is invalid.")
                val orderId = order.requiredTerminalContextUuid("id", "Terminal Kitchen order ID")
                if (!seenKitchenOrderIds.add(orderId)) {
                    throw HubCommandRejectedException("Terminal Kitchen orders have duplicate IDs.")
                }
                val seenProductIds = mutableSetOf<String>()
                val items = order.requiredTerminalContextArray("items", "Terminal Kitchen order lines")
                    .readTerminalContextArray(MAX_ORDER_LINES, "Terminal Kitchen order lines") { item ->
                        item.requireExactTerminalContextKeys(setOf("productId", "name", "quantity"), "Terminal Kitchen order line")
                        val productId = item.requiredTerminalContextUuid("productId", "Terminal Kitchen product ID")
                        if (!seenProductIds.add(productId)) throw HubCommandRejectedException("Terminal Kitchen order has duplicate products.")
                        NativeKitchenOrderLine(
                            productId = productId,
                            name = item.requiredTerminalContextText("name", "Terminal Kitchen product name", MAX_NAME_CHARS),
                            quantity = item.requiredTerminalContextPositiveQuantity("quantity", "Terminal Kitchen quantity"),
                        )
                    }
                if (items.isEmpty()) throw HubCommandRejectedException("Terminal Kitchen order has no lines.")
                NativeKitchenOrder(
                    orderId = orderId,
                    status = status,
                    items = items,
                )
            }

        when (role) {
            "CASHIER" -> if (inventoryProducts.isNotEmpty() || cancellableOrders.isNotEmpty() || pendingKitchenOrders.isNotEmpty()) {
                throw HubCommandRejectedException("The Cashier terminal context contains another role's data.")
            }
            "KITCHEN_STAFF" -> if (catalogProducts.isNotEmpty() || inventoryProducts.isNotEmpty() || activeCashShift != null ||
                pendingCashOrders.isNotEmpty() || readyForCollectionOrders.isNotEmpty() || cancellableOrders.isNotEmpty()
            ) {
                throw HubCommandRejectedException("The Kitchen terminal context contains another role's data.")
            }
            "MANAGER" -> if (catalogProducts.isNotEmpty() || pendingCashOrders.isNotEmpty() ||
                readyForCollectionOrders.isNotEmpty() || pendingKitchenOrders.isNotEmpty()
            ) {
                throw HubCommandRejectedException("The Manager terminal context contains another role's data.")
            }
        }

        return NativeOperatorContext(
            staffName = staffName,
            role = role,
            vatEnabled = vatEnabled,
            vatRate = vatRate,
            catalogProducts = catalogProducts,
            inventoryProducts = inventoryProducts,
            activeCashShift = activeCashShift,
            pendingCashOrders = pendingCashOrders,
            readyForCollectionOrders = readyForCollectionOrders,
            cancellableOrders = cancellableOrders,
            pendingKitchenOrders = pendingKitchenOrders,
            recoverableNativeCommands = emptyList(),
        )
    }

    private const val SCHEMA_VERSION = 1
    private const val MAX_CONTEXT_CHARS = 256 * 1024
    private const val MAX_PRODUCTS = 512
    private const val MAX_ORDERS = 256
    private const val MAX_ORDER_LINES = 100
    private const val MAX_NAME_CHARS = 160
    private const val MAX_CATEGORY_CHARS = 160
    private const val MAX_UNIT_CHARS = 48
    private const val MAX_MONEY = 999_999_999.99
    private const val MAX_VAT_RATE = 100.0
    private const val MAX_STOCK = 99_999_999_999.999
    private val TERMINAL_ROLES = setOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
    private val CASH_PENDING_STATUSES = setOf("PLACED", "PREPARING", "READY")
    private val MANAGER_CANCELLABLE_STATUSES = setOf("PLACED", "PREPARING")
    private val KITCHEN_PENDING_STATUSES = setOf("PLACED", "PREPARING")
    private val ROOT_KEYS = setOf(
        "schemaVersion", "staffName", "role", "vat", "catalogProducts", "inventoryProducts", "activeCashShift",
        "pendingCashOrders", "readyForCollectionOrders", "cancellableOrders", "pendingKitchenOrders"
    )
}

private fun JSONObject.requireExactTerminalContextKeys(expected: Set<String>, subject: String) {
    val present = mutableSetOf<String>()
    val iterator = keys()
    while (iterator.hasNext()) present += iterator.next()
    if (present != expected) throw HubCommandRejectedException("$subject contains unsupported or missing fields.")
}

private fun JSONObject.requiredTerminalContextText(name: String, subject: String, maximum: Int): String {
    val result = optString(name, "").trim()
    if (result.isEmpty() || result.length > maximum) throw HubCommandRejectedException("$subject is invalid.")
    return result
}

private fun JSONObject.requiredTerminalContextBoolean(name: String, subject: String): Boolean {
    if (!has(name)) throw HubCommandRejectedException("$subject is invalid.")
    return opt(name) as? Boolean ?: throw HubCommandRejectedException("$subject is invalid.")
}

private fun JSONObject.requiredTerminalContextUuid(name: String, subject: String): String = try {
    UUID.fromString(requiredTerminalContextText(name, subject, 36)).toString()
} catch (_: IllegalArgumentException) {
    throw HubCommandRejectedException("$subject must be a UUID.")
}

private fun JSONObject.requiredTerminalContextObject(name: String, subject: String): JSONObject =
    optJSONObject(name) ?: throw HubCommandRejectedException("$subject is invalid.")

private fun JSONObject.nullableTerminalContextObject(name: String, subject: String): JSONObject? = when {
    !has(name) -> throw HubCommandRejectedException("$subject is invalid.")
    isNull(name) -> null
    else -> optJSONObject(name) ?: throw HubCommandRejectedException("$subject is invalid.")
}

private fun JSONObject.requiredTerminalContextArray(name: String, subject: String): JSONArray =
    optJSONArray(name) ?: throw HubCommandRejectedException("$subject is invalid.")

private fun <T> JSONArray.readTerminalContextArray(maximum: Int, subject: String, mapper: (JSONObject) -> T): List<T> {
    if (length() > maximum) throw HubCommandRejectedException("$subject contains too many records.")
    return buildList {
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: throw HubCommandRejectedException("$subject is invalid.")
            add(mapper(item))
        }
    }
}

private fun JSONObject.requiredTerminalContextMoney(name: String, subject: String, maximum: Double): Double {
    if (!has(name)) throw HubCommandRejectedException("$subject is invalid.")
    val result = optDouble(name, Double.NaN)
    if (!result.isFinite() || result < 0.0 || result > maximum || kotlin.math.abs(result - roundTerminalContextMoney(result)) > MONEY_EPSILON) {
        throw HubCommandRejectedException("$subject is invalid.")
    }
    return result
}

private fun JSONObject.requiredTerminalContextQuantity(name: String, subject: String): Double {
    if (!has(name)) throw HubCommandRejectedException("$subject is invalid.")
    val result = optDouble(name, Double.NaN)
    if (!result.isFinite() || result < 0.0 || result > 99_999_999_999.999 ||
        kotlin.math.abs(result - roundTerminalContextQuantity(result)) > QUANTITY_EPSILON
    ) {
        throw HubCommandRejectedException("$subject is invalid.")
    }
    return result
}

private fun JSONObject.requiredTerminalContextPositiveQuantity(name: String, subject: String): Double {
    val result = requiredTerminalContextQuantity(name, subject)
    if (result <= 0.0) throw HubCommandRejectedException("$subject is invalid.")
    return result
}

private fun roundTerminalContextMoney(value: Double): Double = Math.round(value * 100.0) / 100.0
private fun roundTerminalContextQuantity(value: Double): Double = Math.round(value * 1_000.0) / 1_000.0
private const val MONEY_EPSILON = 0.000_001
private const val QUANTITY_EPSILON = 0.000_001
