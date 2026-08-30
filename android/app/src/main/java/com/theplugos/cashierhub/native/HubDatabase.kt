package com.theplugos.cashierhub.native

import android.content.Context
import net.zetetic.database.sqlcipher.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

data class ActiveAuthorizationBundle(
    val bundleId: String,
    val businessId: String,
    val branchId: String,
    val hubDeviceId: String,
    val expiresAt: String,
    val revocationVersion: Long,
    val tlsMaterialJson: String?
)

data class VerifiedAuthorizationBundle(
    val bundleId: String,
    val businessId: String,
    val branchId: String,
    val hubDeviceId: String,
    val issuerKeyId: String,
    val issuedAt: String,
    val expiresAt: String,
    val revocationVersion: Long,
    val payloadJson: String,
    val signature: String,
    val tlsMaterialJson: String?,
    val pairedDevices: List<BundlePairedDevice>,
    val staffDirectory: List<BundleStaffDirectoryEntry>,
    val staffSessions: List<BundleStaffSession>,
    val configuration: BundleConfigurationSnapshot
)

data class BundlePairedDevice(
    val deviceId: String,
    val name: String,
    val role: String,
    val publicKeyBase64: String,
    val connectionType: String
)

data class BundleStaffSession(
    val sessionId: String,
    val staffId: String,
    val deviceId: String,
    val role: String,
    val expiresAt: String,
    val revocationVersion: Long
)

/** Non-secret, signed roster used by the native-only fresh PIN surface. */
data class BundleStaffDirectoryEntry(
    val staffId: String,
    val name: String,
    val role: String
)

/**
 * Signed, branch-scoped operational facts needed before the Hub can validate
 * an offline command. These are configuration facts, not browser cache: a
 * renewal replaces only these projections while retained orders/events stay
 * immutable in the ledger.
 */
data class BundleConfigurationSnapshot(
    val vatEnabled: Boolean,
    val vatRate: Double,
    val catalogProducts: List<BundleCatalogProduct>
)

data class BundleCatalogProduct(
    val productId: String,
    val name: String,
    val category: String,
    val price: Double,
    val stockQuantity: Double,
    val unit: String,
    val branchId: String?,
    val status: String
)

data class PairedDeviceRecord(
    val deviceId: String,
    val name: String,
    val role: String,
    val publicKeyBase64: String,
    val businessId: String,
    val branchId: String,
    val status: String,
    val connectionType: String,
    val lastHeartbeat: String?,
    val revokedAt: String?
)

data class StaffSessionRecord(
    val sessionId: String,
    val staffId: String,
    val deviceId: String,
    val role: String,
    val expiresAt: String,
    val revocationVersion: Long,
    val lastSequence: Long,
    val revokedAt: String?
)

data class StaffDirectoryRecord(
    val staffId: String,
    val name: String,
    val role: String
)

/**
 * SQLCipher-backed local ledger. All state-changing operations use one
 * database transaction; notifications and network delivery occur afterward.
 */
class HubDatabase(private val context: Context, private val keys: HubKeyManager) {
    private val monitor = Any()
    private var database: SQLiteDatabase? = null

    init {
        System.loadLibrary("sqlcipher")
    }

    fun activeAuthorizationBundle(): ActiveAuthorizationBundle? = synchronized(monitor) {
        val db = open()
        db.rawQuery(
            "SELECT bundle_id, business_id, branch_id, hub_device_id, expires_at, revocation_version, tls_material_json FROM authorization_bundles WHERE active = 1 LIMIT 1",
            emptyArray()
        ).use { cursor ->
            if (!cursor.moveToFirst()) return@synchronized null
            ActiveAuthorizationBundle(
                bundleId = cursor.getString(0),
                businessId = cursor.getString(1),
                branchId = cursor.getString(2),
                hubDeviceId = cursor.getString(3),
                expiresAt = cursor.getString(4),
                revocationVersion = cursor.getLong(5),
                tlsMaterialJson = cursor.getString(6)
            )
        }
    }

    /** A catalog-bearing authority replacement is safe only after exact cloud
     * acknowledgement has drained every local operational event. */
    fun requireEmptyOperationalOutboxForBundleInstall() = synchronized(monitor) {
        if (hasUnacknowledgedOperationalEvents(open())) {
            throw HubUnavailableException(
                "DEFERRED_UNTIL_SYNC: The Hub has locally committed events awaiting cloud acknowledgement. " +
                    "Its signed catalog state cannot be replaced yet."
            )
        }
    }

    fun installVerifiedAuthorizationBundle(bundle: VerifiedAuthorizationBundle) = synchronized(monitor) {
        validateBundleFacts(bundle)
        val db = open()
        // A bundle carries a cloud catalog/stock snapshot. Replacing that
        // snapshot while a locally committed event still awaits an exact cloud
        // acknowledgement could erase or double-apply a reservation. The
        // caller must drain the durable outbox before any replacement bundle
        // is installed; the existing verified bundle remains authoritative.
        requireEmptyOperationalOutboxForBundleInstall()
        db.beginTransaction()
        try {
            // Renewing a bundle replaces server authority facts, but a session
            // that remains in the new signed bundle must retain its durable
            // command sequence. Resetting it would permit a later cloud event
            // sequence collision for an otherwise still-valid session.
            val priorSequenceBySession = buildMap {
                db.rawQuery("SELECT session_id, last_sequence FROM staff_sessions", emptyArray()).use { cursor ->
                    while (cursor.moveToNext()) put(cursor.getString(0), cursor.getLong(1))
                }
            }
            db.execSQL("UPDATE authorization_bundles SET active = 0 WHERE active = 1")
            db.execSQL("DELETE FROM authorization_bundles WHERE bundle_id = ?", arrayOf(bundle.bundleId))
            // A Hub has exactly one active branch authority. Retaining
            // terminal/session rows from the prior bundle would allow stale
            // local identity facts to survive a server-side revocation or
            // branch handover, so replace them in the same transaction.
            db.execSQL("DELETE FROM staff_sessions")
            db.execSQL("DELETE FROM staff_directory")
            db.execSQL("DELETE FROM paired_devices")
            db.execSQL(
                """
                INSERT INTO authorization_bundles
                (bundle_id, business_id, branch_id, hub_device_id, issuer_key_id, issued_at, expires_at, revocation_version, payload_json, signature, tls_material_json, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                """.trimIndent(),
                arrayOf(
                    bundle.bundleId,
                    bundle.businessId,
                    bundle.branchId,
                    bundle.hubDeviceId,
                    bundle.issuerKeyId,
                    bundle.issuedAt,
                    bundle.expiresAt,
                    bundle.revocationVersion,
                    bundle.payloadJson,
                    bundle.signature,
                    bundle.tlsMaterialJson
                )
            )
            bundle.pairedDevices.forEach { device ->
                db.execSQL(
                    """
                    INSERT INTO paired_devices
                    (device_id, name, role, public_key_base64, business_id, branch_id, status, connection_type, last_heartbeat, revoked_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, NULL, NULL)
                    """.trimIndent(),
                    arrayOf(
                        device.deviceId,
                        device.name,
                        device.role,
                        device.publicKeyBase64,
                        bundle.businessId,
                        bundle.branchId,
                        device.connectionType
                    )
                )
            }
            bundle.staffSessions.forEach { session ->
                db.execSQL(
                    """
                    INSERT INTO staff_sessions
                    (session_id, staff_id, device_id, role, expires_at, revocation_version, last_sequence, revoked_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
                    """.trimIndent(),
                    arrayOf(
                        session.sessionId,
                        session.staffId,
                        session.deviceId,
                        session.role,
                        session.expiresAt,
                        session.revocationVersion,
                        priorSequenceBySession[session.sessionId] ?: -1L
                    )
                )
            }
            // The selector is only a native UI convenience; it is never a
            // bearer credential. Remove it if the signed replacement no
            // longer contains that session.
            db.execSQL(
                "DELETE FROM active_native_staff_session WHERE staff_session_id NOT IN (SELECT session_id FROM staff_sessions)"
            )
            bundle.staffDirectory.forEach { staff ->
                db.execSQL(
                    "INSERT INTO staff_directory (staff_id, name, role) VALUES (?, ?, ?)",
                    arrayOf(staff.staffId, staff.name, staff.role)
                )
            }
            // Authorization renewal must remove stale catalog/configuration
            // facts, but it must never erase locally committed operational
            // projections such as orders. Those historical facts are retained
            // and later acknowledged independently through the cloud outbox.
            db.execSQL("DELETE FROM projections WHERE projection_name IN ('catalog_products', 'configuration')")
            bundle.configuration.catalogProducts.forEach { product ->
                val productJson = JSONObject()
                    .put("id", product.productId)
                    .put("name", product.name)
                    .put("category", product.category)
                    .put("price", product.price)
                    .put("stock", product.stockQuantity)
                    .put("unit", product.unit)
                    .put("branchId", product.branchId)
                    .put("status", product.status)
                    .put("businessId", bundle.businessId)
                db.execSQL(
                    "INSERT INTO projections (projection_name, projection_key, value_json, updated_at) VALUES (?, ?, ?, ?)",
                    arrayOf("catalog_products", product.productId, productJson.toString(), bundle.issuedAt)
                )
            }
            val vatJson = JSONObject()
                .put("enabled", bundle.configuration.vatEnabled)
                .put("rate", bundle.configuration.vatRate)
                .put("businessId", bundle.businessId)
                .put("branchId", bundle.branchId)
                .put("authorizationBundleId", bundle.bundleId)
            db.execSQL(
                "INSERT INTO projections (projection_name, projection_key, value_json, updated_at) VALUES ('configuration', 'vat', ?, ?)",
                arrayOf(vatJson.toString(), bundle.issuedAt)
            )
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun pairedDevice(deviceId: String): PairedDeviceRecord? = synchronized(monitor) {
        val db = open()
        db.rawQuery(
            "SELECT device_id, name, role, public_key_base64, business_id, branch_id, status, connection_type, last_heartbeat, revoked_at FROM paired_devices WHERE device_id = ? LIMIT 1",
            arrayOf(deviceId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return@synchronized null
            PairedDeviceRecord(
                deviceId = cursor.getString(0),
                name = cursor.getString(1),
                role = cursor.getString(2),
                publicKeyBase64 = cursor.getString(3),
                businessId = cursor.getString(4),
                branchId = cursor.getString(5),
                status = cursor.getString(6),
                connectionType = cursor.getString(7),
                lastHeartbeat = cursor.getString(8),
                revokedAt = cursor.getString(9)
            )
        }
    }

    fun staffSession(sessionId: String): StaffSessionRecord? = synchronized(monitor) {
        val db = open()
        db.rawQuery(
            "SELECT session_id, staff_id, device_id, role, expires_at, revocation_version, last_sequence, revoked_at FROM staff_sessions WHERE session_id = ? LIMIT 1",
            arrayOf(sessionId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return@synchronized null
            StaffSessionRecord(
                sessionId = cursor.getString(0),
                staffId = cursor.getString(1),
                deviceId = cursor.getString(2),
                role = cursor.getString(3),
                expiresAt = cursor.getString(4),
                revocationVersion = cursor.getLong(5),
                lastSequence = cursor.getLong(6),
                revokedAt = cursor.getString(7)
            )
        }
    }

    /**
     * Installs a compact terminal-session assertion only after the Hub-side
     * verifier has bound it to the current signed bundle and authenticated
     * local peer. This is deliberately narrower than a bundle replacement:
     * catalog/configuration facts and any queued operational event remain
     * untouched while a terminal signs in.
     */
    fun installVerifiedTerminalStaffSession(
        assertion: VerifiedTerminalStaffSessionAssertion,
        installedAt: String
    ): TerminalStaffSessionInstallReceipt = synchronized(monitor) {
        HubTime.requireCanonicalUtc(installedAt, "Terminal staff-session installation time")
        val bundle = activeAuthorizationBundle()
            ?: throw HubUnavailableException("This Hub has no active authorization bundle.")
        if (assertion.businessId != bundle.businessId || assertion.branchId != bundle.branchId ||
            assertion.hubDeviceId != bundle.hubDeviceId || assertion.revocationVersion != bundle.revocationVersion ||
            assertion.expiresAt > bundle.expiresAt || HubTime.isExpired(assertion.expiresAt, installedAt)
        ) {
            throw HubCommandRejectedException("The terminal staff session is not valid for this Hub authority.")
        }
        val paired = pairedDevice(assertion.terminalDeviceId)
            ?: throw HubCommandRejectedException("The terminal staff session does not name a paired terminal.")
        if (paired.status != "ACTIVE" || paired.revokedAt != null || paired.businessId != bundle.businessId ||
            paired.branchId != bundle.branchId || paired.role != assertion.role ||
            paired.publicKeyBase64 != assertion.terminalSigningPublicKeyBase64
        ) {
            throw HubCommandRejectedException("The terminal staff session does not match the paired terminal.")
        }

        val db = open()
        db.beginTransaction()
        try {
            val existing = staffSession(assertion.sessionId)
            if (existing != null) {
                if (existing.staffId != assertion.staffId || existing.deviceId != assertion.terminalDeviceId ||
                    existing.role != assertion.role || existing.expiresAt != assertion.expiresAt ||
                    existing.revocationVersion != assertion.revocationVersion
                ) {
                    throw HubCommandRejectedException("The terminal staff-session ID is already bound to different authority facts.")
                }
                if (existing.revokedAt != null) {
                    throw HubCommandRejectedException("A revoked terminal staff session cannot be reactivated locally.")
                }
            } else {
                // A terminal has one active local operator. Retain prior rows
                // for their receipt/event references, but mark them revoked so
                // an assertion replay cannot keep an earlier operator active.
                db.execSQL(
                    "UPDATE staff_sessions SET revoked_at = ? WHERE device_id = ? AND session_id <> ? AND revoked_at IS NULL",
                    arrayOf(installedAt, assertion.terminalDeviceId, assertion.sessionId)
                )
                db.execSQL(
                    """
                    INSERT INTO staff_sessions
                    (session_id, staff_id, device_id, role, expires_at, revocation_version, last_sequence, revoked_at)
                    VALUES (?, ?, ?, ?, ?, ?, -1, NULL)
                    """.trimIndent(),
                    arrayOf(
                        assertion.sessionId,
                        assertion.staffId,
                        assertion.terminalDeviceId,
                        assertion.role,
                        assertion.expiresAt,
                        assertion.revocationVersion
                    )
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        TerminalStaffSessionInstallReceipt(assertion.sessionId, assertion.role, assertion.expiresAt)
    }

    fun staffDirectory(): List<StaffDirectoryRecord> = synchronized(monitor) {
        val db = open()
        db.rawQuery(
            "SELECT staff_id, name, role FROM staff_directory ORDER BY name, staff_id",
            emptyArray()
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(StaffDirectoryRecord(cursor.getString(0), cursor.getString(1), cursor.getString(2)))
                }
            }
        }
    }

    /** Selects the session that a completed native PIN flow explicitly
     * activated. The opaque ID remains entirely inside SQLCipher. */
    fun activateNativeStaffSession(staffSessionId: String, hubDeviceId: String, activatedAt: String): StaffSessionRecord = synchronized(monitor) {
        HubTime.requireCanonicalUtc(activatedAt, "Native staff-session activation time")
        val session = staffSession(staffSessionId)
            ?: throw HubCommandRejectedException("The native sign-in session is not present in the current authorization bundle.")
        if (session.deviceId != hubDeviceId || session.revokedAt != null || HubTime.isExpired(session.expiresAt, activatedAt)) {
            throw HubCommandRejectedException("The native sign-in session is not valid for this Hub.")
        }
        val db = open()
        db.execSQL(
            """
            INSERT INTO active_native_staff_session (singleton, staff_session_id, activated_at)
            VALUES (1, ?, ?)
            ON CONFLICT(singleton) DO UPDATE SET
              staff_session_id = excluded.staff_session_id,
              activated_at = excluded.activated_at
            """.trimIndent(),
            arrayOf(session.sessionId, activatedAt)
        )
        session
    }

    /** Ends only the local active-session selector. Durable command intents
     * and every committed operational fact remain intact for safe recovery or
     * later reconciliation; this is not a cloud session revocation. */
    fun endActiveNativeStaffSession(): Boolean = synchronized(monitor) {
        open().delete("active_native_staff_session", "singleton = 1", null) == 1
    }

    fun activeNativeStaffSession(hubDeviceId: String, now: String): StaffSessionRecord? = synchronized(monitor) {
        HubTime.requireCanonicalUtc(now, "Current Hub time")
        val db = open()
        val session = db.rawQuery(
            """
            SELECT s.session_id, s.staff_id, s.device_id, s.role, s.expires_at,
                   s.revocation_version, s.last_sequence, s.revoked_at
            FROM active_native_staff_session active
            JOIN staff_sessions s ON s.session_id = active.staff_session_id
            WHERE active.singleton = 1
            LIMIT 1
            """.trimIndent(),
            emptyArray()
        ).use { cursor ->
            if (!cursor.moveToFirst()) return@synchronized null
            StaffSessionRecord(
                sessionId = cursor.getString(0),
                staffId = cursor.getString(1),
                deviceId = cursor.getString(2),
                role = cursor.getString(3),
                expiresAt = cursor.getString(4),
                revocationVersion = cursor.getLong(5),
                lastSequence = cursor.getLong(6),
                revokedAt = cursor.getString(7)
            )
        }
        if (session.deviceId == hubDeviceId && session.revokedAt == null && !HubTime.isExpired(session.expiresAt, now)) {
            return@synchronized session
        }
        db.execSQL("DELETE FROM active_native_staff_session WHERE singleton = 1")
        null
    }

    /** Returns only non-secret, signed configuration facts after an active
     * native staff selector has passed local expiry/revocation checks. */
    fun nativeOperatorContext(hubDeviceId: String, now: String): NativeOperatorContext? = synchronized(monitor) {
        val session = activeNativeStaffSession(hubDeviceId, now) ?: return@synchronized null
        operatorContextForSession(session, includeNativeRecovery = true)
    }

    /** A terminal projection is scoped to the exact terminal that passed the
     * TLS challenge. A valid-looking session ID from another terminal, a
     * revoked admission, an obsolete bundle revision, or an expired assertion
     * never yields data. */
    fun terminalOperatorContext(
        terminalDeviceId: String,
        staffSessionId: String,
        now: String,
    ): NativeOperatorContext? = synchronized(monitor) {
        HubTime.requireCanonicalUtc(now, "Terminal operator context time")
        val bundle = activeAuthorizationBundle() ?: return@synchronized null
        val session = staffSession(staffSessionId) ?: return@synchronized null
        if (session.deviceId != terminalDeviceId || session.revokedAt != null ||
            session.revocationVersion != bundle.revocationVersion || HubTime.isExpired(session.expiresAt, now)
        ) {
            return@synchronized null
        }
        val terminal = pairedDevice(terminalDeviceId) ?: return@synchronized null
        if (terminal.status != "ACTIVE" || terminal.revokedAt != null ||
            terminal.businessId != bundle.businessId || terminal.branchId != bundle.branchId ||
            terminal.role != session.role || terminal.role !in TERMINAL_OPERATOR_ROLES
        ) {
            return@synchronized null
        }
        operatorContextForSession(session, includeNativeRecovery = false)
    }

    private fun operatorContextForSession(
        session: StaffSessionRecord,
        includeNativeRecovery: Boolean,
    ): NativeOperatorContext? {
        val db = open()
        val staffName = db.rawQuery(
            "SELECT name FROM staff_directory WHERE staff_id = ? LIMIT 1",
            arrayOf(session.staffId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            cursor.getString(0).trim()
        }
        if (staffName.isEmpty()) return null

        val vat = db.rawQuery(
            "SELECT value_json FROM projections WHERE projection_name = 'configuration' AND projection_key = 'vat' LIMIT 1",
            emptyArray()
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            val value = JSONObject(cursor.getString(0))
            val rate = value.optDouble("rate", Double.NaN)
            if (!rate.isFinite() || rate < 0.0 || rate > 100.0 || !value.has("enabled")) return null
            Pair(value.optBoolean("enabled", false), rate)
        }

        val products = db.rawQuery(
            "SELECT value_json FROM projections WHERE projection_name = 'catalog_products' ORDER BY projection_key",
            emptyArray()
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    val value = JSONObject(cursor.getString(0))
                    val productId = value.optString("id", "").trim()
                    val name = value.optString("name", "").trim()
                    val category = value.optString("category", "").trim()
                    val unit = value.optString("unit", "").trim()
                    val status = value.optString("status", "").trim()
                    val price = value.optDouble("price", Double.NaN)
                    val stock = value.optDouble("stock", Double.NaN)
                    try {
                        UUID.fromString(productId)
                    } catch (_: IllegalArgumentException) {
                        throw HubCommandRejectedException("The signed Hub catalog contains an invalid product ID.")
                    }
                    if (name.isEmpty() || category.isEmpty() || unit.isEmpty() || status !in setOf("ACTIVE", "ARCHIVED") ||
                        !price.isFinite() || price < 0.0 || !stock.isFinite() || stock < 0.0
                    ) {
                        throw HubCommandRejectedException("The signed Hub catalog contains invalid product facts.")
                    }
                    if (status == "ACTIVE") {
                        add(NativeCatalogProduct(productId, name, category, price, stock, unit, status))
                    }
                }
            }
        }
        val activeScope = db.rawQuery(
            "SELECT business_id, branch_id FROM authorization_bundles WHERE active = 1 LIMIT 1",
            emptyArray()
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            Pair(cursor.getString(0), cursor.getString(1))
        }
        val businessId = activeScope.first
        val branchId = activeScope.second
        // The operator view is deliberately role-minimized. Kitchen Staff do
        // not receive catalog pricing, VAT, or cash-custody facts merely
        // because they share the same Hub process as a Cashier or Manager.
        val activeCashShift = if (session.role == "CASHIER" || session.role == "MANAGER") {
            readActiveCashShift(db, branchId)
        } else {
            null
        }
        val visibleCatalogProducts = if (session.role == "CASHIER") products else emptyList()
        val inventoryProducts = if (session.role == "MANAGER") {
            products
                .asSequence()
                .filter { it.status == "ACTIVE" }
                .map { product ->
                    NativeInventoryProduct(
                        productId = product.productId,
                        name = product.name,
                        stockQuantity = product.stockQuantity,
                        unit = product.unit
                    )
                }
                .toList()
        } else {
            emptyList()
        }
        val visibleVat = if (session.role == "CASHIER") vat else Pair(false, 0.0)
        val pendingCashOrders = if (session.role == "CASHIER") {
            readPendingCashOrdersForStaff(db, session.staffId, businessId, branchId)
        } else {
            emptyList()
        }
        val readyForCollectionOrders = if (session.role == "CASHIER") {
            readReadyForCollectionOrdersForBranch(db, businessId, branchId)
        } else {
            emptyList()
        }
        val cancellableOrders = if (session.role == "MANAGER") {
            readCancellableOrdersForBranch(db, businessId, branchId)
        } else {
            emptyList()
        }
        val pendingKitchenOrders = if (session.role == "KITCHEN_STAFF") {
            readPendingKitchenOrdersForBranch(db, businessId, branchId)
        } else {
            emptyList()
        }
        val recoverableNativeCommands = if (includeNativeRecovery) {
            readRecoverableNativeCommands(db, session.sessionId)
        } else {
            emptyList()
        }
        return NativeOperatorContext(
            staffName = staffName,
            role = session.role,
            vatEnabled = visibleVat.first,
            vatRate = visibleVat.second,
            catalogProducts = visibleCatalogProducts,
            inventoryProducts = inventoryProducts,
            activeCashShift = activeCashShift,
            pendingCashOrders = pendingCashOrders,
            readyForCollectionOrders = readyForCollectionOrders,
            cancellableOrders = cancellableOrders,
            pendingKitchenOrders = pendingKitchenOrders,
            recoverableNativeCommands = recoverableNativeCommands
        )
    }

    /** The active shift is a committed local projection keyed by branch. A
     * closed marker deliberately remains as the latest branch-shift fact, but
     * is never treated as active authority for a new order or cash capture. */
    fun activeCashShift(branchId: String): NativeCashShift? = synchronized(monitor) {
        readActiveCashShift(open(), branchId)
    }

    private fun readActiveCashShift(db: SQLiteDatabase, branchId: String): NativeCashShift? {
        val value = db.rawQuery(
            "SELECT value_json FROM projections WHERE projection_name = 'active_cash_shift' AND projection_key = ? LIMIT 1",
            arrayOf(branchId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            JSONObject(cursor.getString(0))
        }
        val shiftId = value.optString("shiftId", value.optString("id", "")).trim()
        try {
            UUID.fromString(shiftId)
        } catch (_: IllegalArgumentException) {
            throw HubCommandRejectedException("The active cash shift projection has an invalid shift ID.")
        }
        if (value.optString("branchId", "").trim() != branchId) {
            throw HubCommandRejectedException("The active cash shift projection is invalid.")
        }
        if (value.optString("status", "").trim() == "CLOSED") return null
        if (value.optString("status", "").trim() != "OPEN" || value.optString("currency", "").trim() != "ZAR") {
            throw HubCommandRejectedException("The active cash shift projection is invalid.")
        }
        val openingFloat = readCashMoney(value, "openingFloat")
        val cashSalesTotal = readCashMoney(value, "cashSalesTotal")
        val cashTenderedTotal = readCashMoney(value, "cashTenderedTotal")
        val cashChangeTotal = readCashMoney(value, "cashChangeTotal")
        val expectedCash = readCashMoney(value, "expectedCash")
        if (kotlin.math.abs(expectedCash - roundCashMoney(openingFloat + cashSalesTotal)) > MONEY_EPSILON ||
            cashTenderedTotal + MONEY_EPSILON < cashSalesTotal ||
            cashChangeTotal < -MONEY_EPSILON ||
            kotlin.math.abs(roundCashMoney(cashTenderedTotal - cashChangeTotal) - cashSalesTotal) > MONEY_EPSILON
        ) {
            throw HubCommandRejectedException("The active cash shift totals are inconsistent.")
        }
        return NativeCashShift(
            shiftId = shiftId,
            status = "OPEN",
            openingFloat = openingFloat,
            cashSalesTotal = cashSalesTotal,
            cashTenderedTotal = cashTenderedTotal,
            cashChangeTotal = cashChangeTotal,
            expectedCash = expectedCash
        )
    }

    /** Pending orders bound to an active shift must be resolved before close.
     * We read the committed projection and prove its immutable placement-event
     * scope instead of trusting a retained browser or bundle selection. */
    fun hasPendingOrdersForCashShift(shiftId: String, businessId: String, branchId: String): Boolean = synchronized(monitor) {
        requireNativeUuid(shiftId, "Cash shift ID must be a UUID.")
        open().rawQuery(
            "SELECT projection_key, value_json FROM projections WHERE projection_name = 'orders' ORDER BY projection_key ASC",
            emptyArray()
        ).use { cursor ->
            while (cursor.moveToNext()) {
                val orderId = cursor.getString(0).trim()
                val value = JSONObject(cursor.getString(1))
                if (value.optString("shiftId", "").trim() != shiftId) continue
                val status = value.optString("status", "").trim()
                val paymentStatus = value.optString("paymentStatus", "PENDING").trim()
                if (paymentStatus != "PENDING" || status !in PENDING_CASH_ORDER_STATUSES) continue
                requireNativeUuid(orderId, "A pending cash-shift order projection has an invalid order ID.")
                if (!orderBelongsToScope(orderId, businessId, branchId)) {
                    throw HubCommandRejectedException("A pending cash-shift order has no immutable placement event in this Hub authorization scope.")
                }
                return@synchronized true
            }
            false
        }
    }

    /** Only the active Cashier's own PENDING cash orders are exposed to the
     * native task UI. The event ledger, not a browser owner identity, binds a
     * projection to its originator. */
    private fun readPendingCashOrdersForStaff(
        db: SQLiteDatabase,
        staffId: String,
        businessId: String,
        branchId: String
    ): List<NativePendingCashOrder> =
        db.rawQuery(
            """
            SELECT projection_key, value_json
            FROM projections p
            WHERE p.projection_name = 'orders'
              AND EXISTS (
                  SELECT 1
                  FROM events e
                  WHERE e.aggregate_id = p.projection_key
                    AND e.aggregate_type = 'order'
                    AND e.action = 'ORDER_PLACED'
                    AND e.staff_id = ?
                    AND e.business_id = ?
                    AND e.branch_id = ?
              )
            ORDER BY p.updated_at DESC
            LIMIT ?
            """.trimIndent(),
            arrayOf(staffId, businessId, branchId, MAX_NATIVE_PENDING_CASH_ORDERS.toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    val orderId = cursor.getString(0)
                    val value = JSONObject(cursor.getString(1))
                    val status = value.optString("status", "").trim()
                    val paymentStatus = value.optString("paymentStatus", "PENDING").trim()
                    val paymentMethod = value.optString("paymentMethod", value.optString("paymentType", "")).trim()
                    if (paymentStatus != "PENDING" || paymentMethod != "CASH" || status !in PENDING_CASH_ORDER_STATUSES) continue
                    try {
                        UUID.fromString(orderId)
                    } catch (_: IllegalArgumentException) {
                        throw HubCommandRejectedException("A native pending-cash order projection has an invalid order ID.")
                    }
                    add(NativePendingCashOrder(orderId, status, readCashMoney(value, "totalAmount"), paymentMethod))
                }
            }
        }

    /** A collection task is branch-scoped by its immutable placement event.
     * Only a durable `READY` plus `CAPTURED` projection is exposed; a browser
     * cannot turn a payment intent or visual readiness marker into handover
     * authority. */
    private fun readReadyForCollectionOrdersForBranch(
        db: SQLiteDatabase,
        businessId: String,
        branchId: String
    ): List<NativeReadyForCollectionOrder> =
        db.rawQuery(
            """
            SELECT projection_key, value_json
            FROM projections p
            WHERE p.projection_name = 'orders'
              AND EXISTS (
                  SELECT 1
                  FROM events e
                  WHERE e.aggregate_id = p.projection_key
                    AND e.aggregate_type = 'order'
                    AND e.action = 'ORDER_PLACED'
                    AND e.business_id = ?
                    AND e.branch_id = ?
              )
            ORDER BY p.updated_at ASC, p.projection_key ASC
            LIMIT ?
            """.trimIndent(),
            arrayOf(businessId, branchId, MAX_NATIVE_READY_COLLECTION_ORDERS.toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    val orderId = cursor.getString(0).trim()
                    requireNativeUuid(orderId, "A native collection order projection has an invalid order ID.")
                    val value = JSONObject(cursor.getString(1))
                    val payloadOrderId = value.optString("orderId", value.optString("id", "")).trim()
                    if (payloadOrderId != orderId) {
                        throw HubCommandRejectedException("A native collection order projection has inconsistent order identifiers.")
                    }
                    if (value.optString("status", "").trim() != "READY" ||
                        value.optString("paymentStatus", "").trim() != "CAPTURED"
                    ) {
                        continue
                    }
                    add(NativeReadyForCollectionOrder(orderId, "READY"))
                }
            }
        }

    /** Manager cancellation tasks are branch-scoped by their immutable
     * placement event. The projection only supplies a bounded task ID/status;
     * the router independently rechecks role, payment state, and transition. */
    private fun readCancellableOrdersForBranch(
        db: SQLiteDatabase,
        businessId: String,
        branchId: String
    ): List<NativeCancellableOrder> =
        db.rawQuery(
            """
            SELECT projection_key, value_json
            FROM projections p
            WHERE p.projection_name = 'orders'
              AND EXISTS (
                  SELECT 1
                  FROM events e
                  WHERE e.aggregate_id = p.projection_key
                    AND e.aggregate_type = 'order'
                    AND e.action = 'ORDER_PLACED'
                    AND e.business_id = ?
                    AND e.branch_id = ?
              )
            ORDER BY p.updated_at ASC, p.projection_key ASC
            LIMIT ?
            """.trimIndent(),
            arrayOf(businessId, branchId, MAX_NATIVE_CANCELLABLE_ORDERS.toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    val orderId = cursor.getString(0).trim()
                    requireNativeUuid(orderId, "A native cancellation order projection has an invalid order ID.")
                    val value = JSONObject(cursor.getString(1))
                    val payloadOrderId = value.optString("orderId", value.optString("id", "")).trim()
                    if (payloadOrderId != orderId) {
                        throw HubCommandRejectedException("A native cancellation order projection has inconsistent order identifiers.")
                    }
                    val status = value.optString("status", "").trim()
                    val paymentStatus = value.optString("paymentStatus", "PENDING").trim()
                    if (paymentStatus != "PENDING" || status !in CANCELLABLE_MANAGER_ORDER_STATUSES) continue
                    add(NativeCancellableOrder(orderId, status))
                }
            }
        }

    /** Kitchen task data is scoped by the immutable local placement event,
     * rather than trusting a stale projection alone. This keeps retained
     * projections from a prior branch or bundle out of the active Kitchen
     * workspace and supports older projections which predate scope fields. */
    private fun readPendingKitchenOrdersForBranch(
        db: SQLiteDatabase,
        businessId: String,
        branchId: String
    ): List<NativeKitchenOrder> =
        db.rawQuery(
            """
            SELECT projection_key, value_json
            FROM projections p
            WHERE p.projection_name = 'orders'
              AND EXISTS (
                  SELECT 1
                  FROM events e
                  WHERE e.aggregate_id = p.projection_key
                    AND e.aggregate_type = 'order'
                    AND e.action = 'ORDER_PLACED'
                    AND e.business_id = ?
                    AND e.branch_id = ?
              )
            ORDER BY p.updated_at ASC, p.projection_key ASC
            LIMIT ?
            """.trimIndent(),
            arrayOf(businessId, branchId, MAX_NATIVE_PENDING_KITCHEN_ORDERS.toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    val orderId = cursor.getString(0).trim()
                    requireNativeUuid(orderId, "A native Kitchen order projection has an invalid order ID.")
                    val value = JSONObject(cursor.getString(1))
                    val payloadOrderId = value.optString("orderId", value.optString("id", "")).trim()
                    if (payloadOrderId != orderId) {
                        throw HubCommandRejectedException("A native Kitchen order projection has inconsistent order identifiers.")
                    }
                    val status = value.optString("status", "").trim()
                    if (status !in PENDING_KITCHEN_ORDER_STATUSES) continue
                    val items = value.optJSONArray("items")
                        ?: throw HubCommandRejectedException("A native Kitchen order projection has no line items.")
                    if (items.length() !in 1..MAX_NATIVE_KITCHEN_ORDER_LINES) {
                        throw HubCommandRejectedException("A native Kitchen order projection has an unsupported line-item count.")
                    }
                    val seenProductIds = mutableSetOf<String>()
                    val lines = buildList {
                        for (index in 0 until items.length()) {
                            val item = items.optJSONObject(index)
                                ?: throw HubCommandRejectedException("A native Kitchen order line is invalid.")
                            val productId = item.optString("productId", "").trim()
                            requireNativeUuid(productId, "A native Kitchen order line has an invalid product ID.")
                            if (!seenProductIds.add(productId)) {
                                throw HubCommandRejectedException("A native Kitchen order projection has duplicate products.")
                            }
                            val name = item.optString("name", "").trim()
                            if (name.isEmpty() || name.length > MAX_NATIVE_KITCHEN_ITEM_NAME_LENGTH) {
                                throw HubCommandRejectedException("A native Kitchen order line has an invalid product name.")
                            }
                            val quantity = item.optDouble("quantity", Double.NaN)
                            if (!quantity.isFinite() || quantity <= 0.0 || quantity > MAX_NATIVE_KITCHEN_QUANTITY ||
                                kotlin.math.abs(quantity - roundKitchenQuantity(quantity)) > KITCHEN_QUANTITY_EPSILON
                            ) {
                                throw HubCommandRejectedException("A native Kitchen order line has an invalid quantity.")
                            }
                            add(NativeKitchenOrderLine(productId, name, quantity))
                        }
                    }
                    add(NativeKitchenOrder(orderId, status, lines))
                }
            }
        }

    /** A missing receipt proves no local command transaction committed: the
     * receipt, events, projections, and outbox are one transaction. Only the
     * currently active native staff session may see the matching non-secret
     * task payload for an exact retry. */
    private fun readRecoverableNativeCommands(db: SQLiteDatabase, staffSessionId: String): List<NativeRecoverableCommand> =
        db.rawQuery(
            """
            SELECT intent.command_id, intent.command_type, intent.payload_json
            FROM native_command_intents intent
            LEFT JOIN command_receipts receipt ON receipt.command_id = intent.command_id
            WHERE intent.staff_session_id = ?
              AND receipt.command_id IS NULL
              AND intent.command_type IN ('shift.open', 'shift.close', 'order.create', 'order.status.transition', 'payment.capture', 'inventory.receive', 'inventory.adjust', 'inventory.waste')
            ORDER BY intent.created_at ASC, intent.sequence ASC
            LIMIT ?
            """.trimIndent(),
            arrayOf(staffSessionId, MAX_RECOVERABLE_NATIVE_COMMANDS.toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    val commandId = cursor.getString(0).trim()
                    try {
                        UUID.fromString(commandId)
                    } catch (_: IllegalArgumentException) {
                        throw HubCommandRejectedException("A recoverable native command has an invalid command ID.")
                    }
                    val type = cursor.getString(1).trim()
                    if (type !in RECOVERABLE_NATIVE_COMMAND_TYPES) {
                        throw HubCommandRejectedException("A recoverable native command has an unsupported type.")
                    }
                    val payload = JSONObject(cursor.getString(2))
                    HubPayloadSafety.rejectSensitiveValues(payload)
                    add(NativeRecoverableCommand(commandId, type, payload))
                }
            }
        }

    /**
     * Reserves the native command identity before the KeyStore signs it. A
     * crash or a lost plugin response can therefore retry the same exact
     * command; a new command cannot silently reuse this sequence.
     */
    fun prepareNativeCommandIntent(
        commandId: String,
        deviceId: String,
        staffSessionId: String,
        type: String,
        payload: JSONObject,
        issuedAt: String
    ): NativeCommandIntent = synchronized(monitor) {
        try {
            UUID.fromString(commandId)
        } catch (_: IllegalArgumentException) {
            throw HubCommandRejectedException("Native command ID must be a UUID.")
        }
        HubTime.requireCanonicalUtc(issuedAt, "Native command issue time")
        if (type.isBlank() || type.length > 120) throw HubCommandRejectedException("Native command type is invalid.")
        HubPayloadSafety.rejectSensitiveValues(payload)
        val payloadJson = payload.toString()
        val payloadBase64 = HubWireEncoding.encode(payloadJson.toByteArray(Charsets.UTF_8))
        val db = open()
        db.beginTransaction()
        try {
            val existing = readNativeCommandIntent(db, commandId)
            if (existing != null) {
                if (
                    existing.deviceId != deviceId ||
                    existing.staffSessionId != staffSessionId ||
                    existing.type != type ||
                    existing.payloadBase64 != payloadBase64
                ) {
                    throw HubCommandRejectedException("This native command ID is already bound to different request data.")
                }
                db.setTransactionSuccessful()
                return@synchronized existing
            }
            if (readReceipt(db, commandId) != null) {
                throw HubCommandRejectedException("This native command ID is already bound to an external command receipt.")
            }

            val session = staffSession(staffSessionId)
                ?: throw HubCommandRejectedException("The active native staff session no longer exists.")
            if (session.deviceId != deviceId || session.revokedAt != null) {
                throw HubCommandRejectedException("The active native staff session is not valid for this Hub.")
            }
            val reservedSequence = db.rawQuery(
                "SELECT COALESCE(MAX(sequence), -1) FROM native_command_intents WHERE staff_session_id = ?",
                arrayOf(staffSessionId)
            ).use { cursor ->
                cursor.moveToFirst()
                maxOf(session.lastSequence, cursor.getLong(0))
            }
            if (reservedSequence == Long.MAX_VALUE) throw HubCommandRejectedException("Native command sequence is exhausted.")
            val nextSequence = reservedSequence + 1
            db.execSQL(
                """
                INSERT INTO native_command_intents
                (command_id, device_id, staff_session_id, command_type, issued_at, sequence, payload_json, payload_base64, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                arrayOf(commandId, deviceId, staffSessionId, type, issuedAt, nextSequence, payloadJson, payloadBase64, issuedAt)
            )
            val intent = NativeCommandIntent(
                commandId = commandId,
                deviceId = deviceId,
                staffSessionId = staffSessionId,
                type = type,
                issuedAt = issuedAt,
                sequence = nextSequence,
                payloadBase64 = payloadBase64,
                payload = JSONObject(payloadJson)
            )
            db.setTransactionSuccessful()
            intent
        } finally {
            db.endTransaction()
        }
    }

    /** Removes only an uncommitted intent for the current native session. A
     * committed command has a receipt in the same SQLCipher transaction and
     * can never be abandoned through this path. */
    fun discardUncommittedNativeCommandIntent(commandId: String, staffSessionId: String): Boolean = synchronized(monitor) {
        try {
            UUID.fromString(commandId)
        } catch (_: IllegalArgumentException) {
            throw HubCommandRejectedException("Native command ID must be a UUID.")
        }
        val db = open()
        db.beginTransaction()
        try {
            val intent = readNativeCommandIntent(db, commandId) ?: return@synchronized false
            if (intent.staffSessionId != staffSessionId) {
                throw HubCommandRejectedException("Only the originating native staff session may abandon this command intent.")
            }
            if (readReceipt(db, commandId) != null) {
                throw HubCommandRejectedException("A committed native command cannot be abandoned; retry it to read its receipt.")
            }
            val removed = db.delete(
                "native_command_intents",
                "command_id = ? AND staff_session_id = ?",
                arrayOf(commandId, staffSessionId)
            )
            if (removed != 1) throw HubCommandRejectedException("The native command intent could not be abandoned safely.")
            db.setTransactionSuccessful()
            true
        } finally {
            db.endTransaction()
        }
    }

    /** Returns an existing receipt before routing an exact signed retry. This
     * avoids a projection-level duplicate check masking idempotency. */
    fun duplicateReceipt(command: OperationalCommand, context: VerifiedCommandContext): HubReceipt? = synchronized(monitor) {
        val existing = readReceipt(open(), command.commandId) ?: return@synchronized null
        if (existing.commandFingerprint.isBlank() ||
            !sameReceiptPrincipal(existing.receipt, command, context) ||
            existing.commandFingerprint != command.fingerprint()
        ) {
            throw HubCommandRejectedException("This command ID is already bound to a different signed command.")
        }
        existing.receipt.copy(outcome = "DUPLICATE")
    }

    fun commit(
        command: OperationalCommand,
        context: VerifiedCommandContext,
        events: List<HubEventDraft>,
        projections: List<ProjectionWrite>,
        committedAt: String
    ): HubReceipt = synchronized(monitor) {
        val db = open()
        db.beginTransaction()
        try {
            val commandFingerprint = command.fingerprint()
            readReceipt(db, command.commandId)?.let { existing ->
                if (existing.commandFingerprint.isBlank()) {
                    // A receipt created by an older, incompatible ledger
                    // schema cannot be safely matched to a retry. Refuse it
                    // rather than risking a second business effect.
                    throw HubCommandRejectedException("This command ID exists in an incompatible local receipt record. Reconcile the Hub before retrying it.")
                }
                if (!sameReceiptPrincipal(existing.receipt, command, context) || existing.commandFingerprint != commandFingerprint) {
                    throw HubCommandRejectedException("This command ID is already bound to a different signed command.")
                }
                db.setTransactionSuccessful()
                return@synchronized existing.receipt.copy(outcome = "DUPLICATE")
            }

            val staffSession = staffSession(command.staffSessionId)
                ?: throw HubCommandRejectedException("The staff session no longer exists.")
            if (command.sequence <= staffSession.lastSequence) {
                throw HubCommandRejectedException("The terminal command sequence has already been processed or is stale.")
            }

            val eventIds = mutableListOf<String>()
            val outboxIds = mutableListOf<String>()
            events.forEachIndexed { eventOrdinal, draft ->
                val eventId = UUID.randomUUID().toString()
                val outboxId = UUID.randomUUID().toString()
                eventIds += eventId
                outboxIds += outboxId

                db.execSQL(
                    """
                    INSERT INTO events
                    (event_id, command_id, aggregate_id, aggregate_type, action, business_id, branch_id, device_id, staff_id, staff_session_id, sequence, event_ordinal, occurred_at, schema_version, payload_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """.trimIndent(),
                    arrayOf(
                        eventId,
                        command.commandId,
                        draft.aggregateId,
                        draft.aggregateType,
                        draft.action,
                        context.businessId,
                        context.branchId,
                        context.deviceId,
                        context.staffId,
                        context.staffSessionId,
                        command.sequence,
                        eventOrdinal,
                        committedAt,
                        draft.schemaVersion,
                        draft.payload.toString()
                    )
                )
                db.execSQL(
                    "INSERT INTO cloud_outbox (outbox_id, event_id, command_id, business_id, branch_id, enqueued_at, attempts, status) VALUES (?, ?, ?, ?, ?, ?, 0, 'PENDING')",
                    arrayOf(outboxId, eventId, command.commandId, context.businessId, context.branchId, committedAt)
                )
            }

            projections.forEach { projection ->
                db.execSQL(
                    """
                    INSERT INTO projections (projection_name, projection_key, value_json, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(projection_name, projection_key)
                    DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
                    """.trimIndent(),
                    arrayOf(projection.name, projection.key, projection.value.toString(), committedAt)
                )
            }

            val receipt = HubReceipt(
                commandId = command.commandId,
                businessId = context.businessId,
                branchId = context.branchId,
                deviceId = context.deviceId,
                staffSessionId = context.staffSessionId,
                type = command.type,
                sequence = command.sequence,
                outcome = "APPLIED",
                committedAt = committedAt,
                eventIds = eventIds,
                outboxIds = outboxIds
            )
            db.execSQL(
                """
                INSERT INTO command_receipts
                (command_id, command_fingerprint, business_id, branch_id, device_id, staff_session_id, command_type, sequence, outcome, committed_at, event_ids_json, outbox_ids_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """.trimIndent(),
                arrayOf(
                    receipt.commandId,
                    commandFingerprint,
                    receipt.businessId,
                    receipt.branchId,
                    receipt.deviceId,
                    receipt.staffSessionId,
                    receipt.type,
                    receipt.sequence,
                    receipt.outcome,
                    receipt.committedAt,
                    JSONArray(receipt.eventIds).toString(),
                    JSONArray(receipt.outboxIds).toString()
                )
            )
            db.execSQL(
                "INSERT INTO audit_records (audit_id, command_id, business_id, branch_id, device_id, staff_id, staff_session_id, command_type, recorded_at, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED')",
                arrayOf(UUID.randomUUID().toString(), command.commandId, context.businessId, context.branchId, context.deviceId, context.staffId, context.staffSessionId, command.type, committedAt)
            )
            db.execSQL(
                "UPDATE staff_sessions SET last_sequence = ? WHERE session_id = ?",
                arrayOf(command.sequence, context.staffSessionId)
            )
            db.setTransactionSuccessful()
            receipt
        } finally {
            db.endTransaction()
        }
    }

    fun outbox(): List<JSONObject> = synchronized(monitor) {
        val db = open()
        db.rawQuery(
            "SELECT event_id, command_id, enqueued_at, attempts, status FROM cloud_outbox WHERE status != 'ACKNOWLEDGED' ORDER BY enqueued_at ASC",
            emptyArray()
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        JSONObject()
                            .put("eventId", cursor.getString(0))
                            .put("commandId", cursor.getString(1))
                            .put("timestamp", cursor.getString(2))
                            .put("attempts", cursor.getInt(3))
                            .put("status", cursor.getString(4))
                    )
                }
            }
        }
    }

    /**
     * Returns immutable event envelopes for a single signed cloud batch. The
     * rows remain durable until the cloud returns each exact event ID in its
     * acknowledgement; transport attempts alone never delete or acknowledge.
     */
    fun pendingCloudEvents(limit: Int, deliveryHubDeviceId: String): List<JSONObject> = synchronized(monitor) {
        val boundedLimit = limit.coerceIn(1, MAX_CLOUD_BATCH_EVENTS)
        val bundle = activeAuthorizationBundle()
            ?: throw HubUnavailableException("A verified Hub bundle is required before cloud event delivery.")
        if (bundle.hubDeviceId != deliveryHubDeviceId) {
            throw HubCommandRejectedException("Cloud event delivery must use the active Hub device identity.")
        }
        val db = open()
        db.rawQuery(
            """
            SELECT e.event_id, e.command_id, e.aggregate_id, e.aggregate_type, e.action,
                   e.business_id, e.branch_id, e.device_id, e.staff_id, e.staff_session_id,
                   e.sequence, e.event_ordinal, e.occurred_at, e.schema_version, e.payload_json
            FROM cloud_outbox o
            JOIN events e ON e.event_id = o.event_id
            WHERE o.status IN ('PENDING', 'FAILED')
            -- `cloud_outbox` is written in the same SQLCipher transaction as
            -- each event. Its SQLite rowid is therefore the sole durable
            -- cross-session commit order; staff-session sequence numbers are
            -- intentionally not globally comparable.
            ORDER BY o.rowid ASC
            LIMIT ?
            """.trimIndent(),
            arrayOf(boundedLimit.toString())
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        JSONObject()
                            .put("eventId", cursor.getString(0))
                            .put("commandId", cursor.getString(1))
                            .put("entityId", cursor.getString(2))
                            .put("entityType", cursor.getString(3))
                            .put("action", cursor.getString(4))
                            .put("businessId", cursor.getString(5))
                            .put("branchId", cursor.getString(6))
                            // `deviceId` is the Hub delivery/transaction
                            // authority expected by the cloud receiver. The
                            // original terminal command device remains bound
                            // immutably through staffSessionId, which maps to
                            // R014's command_device_id in cloud authority.
                            .put("deviceId", deliveryHubDeviceId)
                            .put("staffId", cursor.getString(8))
                            .put("staffSessionId", cursor.getString(9))
                            .put("sequence", cursor.getLong(10))
                            .put("eventOrdinal", cursor.getInt(11))
                            .put("timestamp", cursor.getString(12))
                            .put("schemaVersion", cursor.getInt(13))
                            .put("payload", JSONObject(cursor.getString(14)))
                    )
                }
            }
        }
    }

    fun acknowledgeCloudEvents(eventIds: Collection<String>, acknowledgedAt: String) = synchronized(monitor) {
        if (eventIds.isEmpty()) return@synchronized
        HubTime.requireCanonicalUtc(acknowledgedAt, "Cloud acknowledgement time")
        val db = open()
        db.beginTransaction()
        try {
            eventIds.distinct().forEach { eventId ->
                db.execSQL(
                    """
                    UPDATE cloud_outbox
                    SET status = 'ACKNOWLEDGED', acknowledged_at = ?, last_error = NULL
                    WHERE event_id = ? AND status != 'ACKNOWLEDGED'
                    """.trimIndent(),
                    arrayOf(acknowledgedAt, eventId)
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun recordCloudSyncFailure(eventIds: Collection<String>, reason: String) = synchronized(monitor) {
        if (eventIds.isEmpty()) return@synchronized
        val safeReason = reason.take(MAX_SYNC_ERROR_CHARS)
        val db = open()
        db.beginTransaction()
        try {
            eventIds.distinct().forEach { eventId ->
                db.execSQL(
                    """
                    UPDATE cloud_outbox
                    SET attempts = attempts + 1, status = 'FAILED', last_error = ?
                    WHERE event_id = ? AND status != 'ACKNOWLEDGED'
                    """.trimIndent(),
                    arrayOf(safeReason, eventId)
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun lastCloudAcknowledgement(): String? = synchronized(monitor) {
        val db = open()
        db.rawQuery(
            "SELECT MAX(acknowledged_at) FROM cloud_outbox WHERE acknowledged_at IS NOT NULL",
            emptyArray()
        ).use { cursor ->
            if (!cursor.moveToFirst() || cursor.isNull(0)) null else cursor.getString(0)
        }
    }

    fun projection(name: String, key: String): JSONObject? = synchronized(monitor) {
        val db = open()
        db.rawQuery(
            "SELECT value_json FROM projections WHERE projection_name = ? AND projection_key = ? LIMIT 1",
            arrayOf(name, key)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return@synchronized null
            JSONObject(cursor.getString(0))
        }
    }

    /** A local order projection is usable only when its immutable placement
     * event proves it belongs to the active authorization scope. This avoids a
     * retained prior-branch projection becoming command authority after a Hub
     * is re-enrolled. */
    fun orderBelongsToScope(orderId: String, businessId: String, branchId: String): Boolean = synchronized(monitor) {
        requireNativeUuid(orderId, "Order ID must be a UUID.")
        open().rawQuery(
            """
            SELECT 1
            FROM events
            WHERE aggregate_id = ?
              AND aggregate_type = 'order'
              AND action = 'ORDER_PLACED'
              AND business_id = ?
              AND branch_id = ?
            LIMIT 1
            """.trimIndent(),
            arrayOf(orderId, businessId, branchId)
        ).use { cursor -> cursor.moveToFirst() }
    }

    fun events(eventIds: List<String>): List<JSONObject> = synchronized(monitor) {
        if (eventIds.isEmpty()) return@synchronized emptyList()
        val placeholders = eventIds.joinToString(",") { "?" }
        val db = open()
        db.rawQuery(
            """
            SELECT event_id, command_id, aggregate_id, aggregate_type, action,
                   business_id, branch_id, device_id, staff_id, staff_session_id,
                   sequence, event_ordinal, occurred_at, schema_version, payload_json
            FROM events
            WHERE event_id IN ($placeholders)
            ORDER BY sequence ASC, event_ordinal ASC
            """.trimIndent(),
            eventIds.toTypedArray()
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        JSONObject()
                            .put("eventId", cursor.getString(0))
                            .put("commandId", cursor.getString(1))
                            .put("entityId", cursor.getString(2))
                            .put("entityType", cursor.getString(3))
                            .put("action", cursor.getString(4))
                            .put("businessId", cursor.getString(5))
                            .put("branchId", cursor.getString(6))
                            .put("deviceId", cursor.getString(7))
                            .put("staffId", cursor.getString(8))
                            .put("staffSessionId", cursor.getString(9))
                            .put("sequence", cursor.getLong(10))
                            .put("eventOrdinal", cursor.getInt(11))
                            .put("timestamp", cursor.getString(12))
                            .put("schemaVersion", cursor.getInt(13))
                            .put("payload", JSONObject(cursor.getString(14)))
                    )
                }
            }
        }
    }

    fun pairedDevices(): List<HubDevice> = synchronized(monitor) {
        val db = open()
        db.rawQuery(
            "SELECT device_id, name, role, status, connection_type, last_heartbeat, business_id, branch_id FROM paired_devices WHERE status != 'REVOKED' ORDER BY name",
            emptyArray()
        ).use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(
                        HubDevice(
                            id = cursor.getString(0),
                            name = cursor.getString(1),
                            role = cursor.getString(2),
                            status = cursor.getString(3),
                            connectionType = cursor.getString(4),
                            queuedEvents = 0,
                            lastHeartbeat = cursor.getString(5),
                            businessId = cursor.getString(6),
                            branchId = cursor.getString(7)
                        )
                    )
                }
            }
        }
    }

    fun outboxDepth(): Int = synchronized(monitor) {
        val db = open()
        db.rawQuery("SELECT COUNT(*) FROM cloud_outbox WHERE status != 'ACKNOWLEDGED'", emptyArray()).use { cursor ->
            cursor.moveToFirst()
            cursor.getInt(0)
        }
    }

    fun close() = synchronized(monitor) {
        database?.close()
        database = null
    }

    private fun hasUnacknowledgedOperationalEvents(db: SQLiteDatabase): Boolean =
        db.rawQuery(
            "SELECT 1 FROM cloud_outbox WHERE status != 'ACKNOWLEDGED' LIMIT 1",
            emptyArray()
        ).use { cursor -> cursor.moveToFirst() }

    private fun readReceipt(db: SQLiteDatabase, commandId: String): StoredReceipt? {
        db.rawQuery(
            "SELECT command_fingerprint, business_id, branch_id, device_id, staff_session_id, command_type, sequence, outcome, committed_at, event_ids_json, outbox_ids_json FROM command_receipts WHERE command_id = ? LIMIT 1",
            arrayOf(commandId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return StoredReceipt(
                commandFingerprint = cursor.getString(0),
                receipt = HubReceipt(
                    commandId = commandId,
                    businessId = cursor.getString(1),
                    branchId = cursor.getString(2),
                    deviceId = cursor.getString(3),
                    staffSessionId = cursor.getString(4),
                    type = cursor.getString(5),
                    sequence = cursor.getLong(6),
                    outcome = cursor.getString(7),
                    committedAt = cursor.getString(8),
                    eventIds = jsonArrayToStrings(cursor.getString(9)),
                    outboxIds = jsonArrayToStrings(cursor.getString(10))
                )
            )
        }
    }

    private fun readNativeCommandIntent(db: SQLiteDatabase, commandId: String): NativeCommandIntent? {
        db.rawQuery(
            """
            SELECT command_id, device_id, staff_session_id, command_type, issued_at,
                   sequence, payload_base64, payload_json
            FROM native_command_intents
            WHERE command_id = ?
            LIMIT 1
            """.trimIndent(),
            arrayOf(commandId)
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return NativeCommandIntent(
                commandId = cursor.getString(0),
                deviceId = cursor.getString(1),
                staffSessionId = cursor.getString(2),
                type = cursor.getString(3),
                issuedAt = cursor.getString(4),
                sequence = cursor.getLong(5),
                payloadBase64 = cursor.getString(6),
                payload = JSONObject(cursor.getString(7))
            )
        }
    }

    private fun open(): SQLiteDatabase {
        database?.let { return it }
        val databaseFile: File = context.getDatabasePath(DATABASE_NAME)
        databaseFile.parentFile?.mkdirs()
        val db = SQLiteDatabase.openOrCreateDatabase(databaseFile, keys.databasePassphrase(), null, null, null)
        db.enableWriteAheadLogging()
        createSchema(db)
        database = db
        return db
    }

    private fun createSchema(db: SQLiteDatabase) {
        db.execSQL("PRAGMA foreign_keys = ON")
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS authorization_bundles (
              bundle_id TEXT PRIMARY KEY,
              business_id TEXT NOT NULL,
              branch_id TEXT NOT NULL,
              hub_device_id TEXT NOT NULL,
              issuer_key_id TEXT NOT NULL,
              issued_at TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              revocation_version INTEGER NOT NULL,
              payload_json TEXT NOT NULL,
              signature TEXT NOT NULL,
              tls_material_json TEXT,
              active INTEGER NOT NULL CHECK(active IN (0, 1))
            )
        """.trimIndent())
        db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS one_active_authorization_bundle ON authorization_bundles(active) WHERE active = 1")
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS staff_directory (
              staff_id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              role TEXT NOT NULL
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS paired_devices (
              device_id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              role TEXT NOT NULL,
              public_key_base64 TEXT NOT NULL,
              business_id TEXT NOT NULL,
              branch_id TEXT NOT NULL,
              status TEXT NOT NULL,
              connection_type TEXT NOT NULL,
              last_heartbeat TEXT,
              revoked_at TEXT
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS staff_sessions (
              session_id TEXT PRIMARY KEY,
              staff_id TEXT NOT NULL,
              device_id TEXT NOT NULL,
              role TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              revocation_version INTEGER NOT NULL,
              last_sequence INTEGER NOT NULL DEFAULT -1,
              revoked_at TEXT
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS active_native_staff_session (
              singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
              staff_session_id TEXT NOT NULL,
              activated_at TEXT NOT NULL
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS native_command_intents (
              command_id TEXT PRIMARY KEY,
              device_id TEXT NOT NULL,
              staff_session_id TEXT NOT NULL,
              command_type TEXT NOT NULL,
              issued_at TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              payload_json TEXT NOT NULL,
              payload_base64 TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(staff_session_id, sequence)
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS native_command_intents_session ON native_command_intents(staff_session_id, sequence)")
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS command_receipts (
              command_id TEXT PRIMARY KEY,
              command_fingerprint TEXT NOT NULL,
              business_id TEXT NOT NULL,
              branch_id TEXT NOT NULL,
              device_id TEXT NOT NULL,
              staff_session_id TEXT NOT NULL,
              command_type TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              outcome TEXT NOT NULL,
              committed_at TEXT NOT NULL,
              event_ids_json TEXT NOT NULL,
              outbox_ids_json TEXT NOT NULL
            )
        """.trimIndent())
        ensureColumn(db, "command_receipts", "command_fingerprint", "TEXT NOT NULL DEFAULT ''")
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS events (
              event_id TEXT PRIMARY KEY,
              command_id TEXT NOT NULL,
              aggregate_id TEXT NOT NULL,
              aggregate_type TEXT NOT NULL,
              action TEXT NOT NULL,
              business_id TEXT NOT NULL,
              branch_id TEXT NOT NULL,
              device_id TEXT NOT NULL,
              staff_id TEXT NOT NULL,
              staff_session_id TEXT NOT NULL,
              sequence INTEGER NOT NULL,
              event_ordinal INTEGER NOT NULL,
              occurred_at TEXT NOT NULL,
              schema_version INTEGER NOT NULL,
              payload_json TEXT NOT NULL
            )
        """.trimIndent())
        ensureColumn(db, "events", "event_ordinal", "INTEGER NOT NULL DEFAULT 0")
        db.execSQL("CREATE INDEX IF NOT EXISTS events_branch_sequence ON events(branch_id, sequence, event_ordinal)")
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS projections (
              projection_name TEXT NOT NULL,
              projection_key TEXT NOT NULL,
              value_json TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(projection_name, projection_key)
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS cloud_outbox (
              outbox_id TEXT PRIMARY KEY,
              event_id TEXT NOT NULL UNIQUE,
              command_id TEXT NOT NULL,
              business_id TEXT NOT NULL,
              branch_id TEXT NOT NULL,
              enqueued_at TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0,
              status TEXT NOT NULL,
              acknowledged_at TEXT,
              last_error TEXT
            )
        """.trimIndent())
        db.execSQL("CREATE INDEX IF NOT EXISTS cloud_outbox_pending ON cloud_outbox(status, enqueued_at)")
        db.execSQL("""
            CREATE TABLE IF NOT EXISTS audit_records (
              audit_id TEXT PRIMARY KEY,
              command_id TEXT NOT NULL,
              business_id TEXT NOT NULL,
              branch_id TEXT NOT NULL,
              device_id TEXT NOT NULL,
              staff_id TEXT NOT NULL,
              staff_session_id TEXT NOT NULL,
              command_type TEXT NOT NULL,
              recorded_at TEXT NOT NULL,
              outcome TEXT NOT NULL
            )
        """.trimIndent())
    }

    private fun jsonArrayToStrings(value: String): List<String> {
        val array = JSONArray(value)
        return buildList { for (index in 0 until array.length()) add(array.getString(index)) }
    }

    private fun readCashMoney(value: JSONObject, field: String): Double {
        if (!value.has(field)) throw HubCommandRejectedException("A native financial projection is missing $field.")
        val amount = value.optDouble(field, Double.NaN)
        if (!amount.isFinite() || amount < 0.0 || amount > MAX_CASH_AMOUNT ||
            kotlin.math.abs(amount - roundCashMoney(amount)) > MONEY_EPSILON
        ) {
            throw HubCommandRejectedException("A native financial projection has an invalid $field value.")
        }
        return amount
    }

    private fun requireNativeUuid(value: String, message: String) {
        try {
            UUID.fromString(value)
        } catch (_: IllegalArgumentException) {
            throw HubCommandRejectedException(message)
        }
    }

    private fun roundCashMoney(value: Double): Double = Math.round(value * 100.0) / 100.0

    private fun roundKitchenQuantity(value: Double): Double = Math.round(value * 1_000.0) / 1_000.0

    private fun sameReceiptPrincipal(
        receipt: HubReceipt,
        command: OperationalCommand,
        context: VerifiedCommandContext
    ): Boolean = receipt.businessId == context.businessId &&
        receipt.branchId == context.branchId &&
        receipt.deviceId == context.deviceId &&
        receipt.staffSessionId == context.staffSessionId &&
        receipt.type == command.type &&
        receipt.sequence == command.sequence

    private fun validateBundleFacts(bundle: VerifiedAuthorizationBundle) {
        HubTime.requireCanonicalUtc(bundle.issuedAt, "Authorization bundle issuedAt")
        HubTime.requireCanonicalUtc(bundle.expiresAt, "Authorization bundle expiresAt")
        if (HubTime.isExpired(bundle.expiresAt, bundle.issuedAt)) {
            throw HubCommandRejectedException("The verified authorization bundle is already expired.")
        }
        val deviceIds = bundle.pairedDevices.map { it.deviceId }
        if (deviceIds.size != deviceIds.toSet().size || deviceIds.any { it.isBlank() }) {
            throw HubCommandRejectedException("The verified authorization bundle has invalid paired-device facts.")
        }
        if (bundle.pairedDevices.any { it.name.isBlank() || it.role.isBlank() || it.publicKeyBase64.isBlank() || it.connectionType.isBlank() }) {
            throw HubCommandRejectedException("The verified authorization bundle has incomplete paired-device facts.")
        }
        val sessionIds = bundle.staffSessions.map { it.sessionId }
        if (sessionIds.size != sessionIds.toSet().size || sessionIds.any { it.isBlank() }) {
            throw HubCommandRejectedException("The verified authorization bundle has invalid staff-session facts.")
        }
        if (bundle.staffSessions.any { session ->
                session.staffId.isBlank() || session.deviceId !in deviceIds || session.role.isBlank() || session.expiresAt.isBlank() || session.revocationVersion < 0
            }) {
            throw HubCommandRejectedException("The verified authorization bundle has incomplete or unpaired staff-session facts.")
        }
        bundle.staffSessions.forEach { session ->
            HubTime.requireCanonicalUtc(session.expiresAt, "Staff-session expiry")
            if (HubTime.isExpired(session.expiresAt, bundle.issuedAt)) {
                throw HubCommandRejectedException("The verified authorization bundle contains an already expired staff session.")
            }
        }
        val directoryIds = bundle.staffDirectory.map { it.staffId }
        if (directoryIds.size != directoryIds.toSet().size || directoryIds.any { it.isBlank() }) {
            throw HubCommandRejectedException("The verified authorization bundle has invalid staff-directory facts.")
        }
        if (bundle.staffDirectory.any { it.name.isBlank() || it.role !in setOf("CASHIER", "KITCHEN_STAFF", "MANAGER", "OWNER", "ADMINISTRATOR") }) {
            throw HubCommandRejectedException("The verified authorization bundle has incomplete staff-directory facts.")
        }
        if (bundle.staffSessions.any { it.staffId !in directoryIds }) {
            throw HubCommandRejectedException("The verified authorization bundle has a session outside its signed staff directory.")
        }
        if (!bundle.configuration.vatRate.isFinite() || bundle.configuration.vatRate < 0.0 || bundle.configuration.vatRate > 100.0) {
            throw HubCommandRejectedException("The verified authorization bundle has an invalid VAT configuration.")
        }
        val catalogIds = bundle.configuration.catalogProducts.map { it.productId }
        if (catalogIds.size != catalogIds.toSet().size || catalogIds.any { it.isBlank() }) {
            throw HubCommandRejectedException("The verified authorization bundle has duplicate or invalid catalog product IDs.")
        }
        if (bundle.configuration.catalogProducts.any { product ->
                product.name.isBlank() || product.category.isBlank() || product.unit.isBlank() ||
                    !product.price.isFinite() || product.price < 0.0 ||
                    !product.stockQuantity.isFinite() || product.stockQuantity < 0.0 ||
                    (product.branchId != null && product.branchId != bundle.branchId) ||
                    product.status !in setOf("ACTIVE", "ARCHIVED")
            }) {
            throw HubCommandRejectedException("The verified authorization bundle has an invalid branch catalog snapshot.")
        }
    }

    private fun ensureColumn(db: SQLiteDatabase, table: String, column: String, definition: String) {
        val exists = db.rawQuery("PRAGMA table_info($table)", emptyArray()).use { cursor ->
            var found = false
            while (cursor.moveToNext()) {
                if (cursor.getString(1) == column) {
                    found = true
                    break
                }
            }
            found
        }
        if (!exists) db.execSQL("ALTER TABLE $table ADD COLUMN $column $definition")
    }

    private data class StoredReceipt(
        val receipt: HubReceipt,
        val commandFingerprint: String
    )

    private companion object {
        const val DATABASE_NAME = "theplugos_cashier_hub_v1.db"
        const val MAX_CLOUD_BATCH_EVENTS = 100
        const val MAX_SYNC_ERROR_CHARS = 160
        const val MAX_NATIVE_PENDING_CASH_ORDERS = 100
        const val MAX_NATIVE_READY_COLLECTION_ORDERS = 100
        const val MAX_NATIVE_CANCELLABLE_ORDERS = 100
        const val MAX_NATIVE_PENDING_KITCHEN_ORDERS = 100
        const val MAX_NATIVE_KITCHEN_ORDER_LINES = 100
        const val MAX_NATIVE_KITCHEN_ITEM_NAME_LENGTH = 500
        const val MAX_NATIVE_KITCHEN_QUANTITY = 1_000_000.0
        const val MAX_RECOVERABLE_NATIVE_COMMANDS = 20
        const val MAX_CASH_AMOUNT = 999_999_999.99
        const val MONEY_EPSILON = 0.000_001
        const val KITCHEN_QUANTITY_EPSILON = 0.000_001
        val PENDING_CASH_ORDER_STATUSES = setOf("PLACED", "PREPARING", "READY")
        val CANCELLABLE_MANAGER_ORDER_STATUSES = setOf("PLACED", "PREPARING")
        val PENDING_KITCHEN_ORDER_STATUSES = setOf("PLACED", "PREPARING")
        val TERMINAL_OPERATOR_ROLES = setOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
        val RECOVERABLE_NATIVE_COMMAND_TYPES = setOf("shift.open", "shift.close", "order.create", "order.status.transition", "payment.capture", "inventory.receive", "inventory.adjust", "inventory.waste")
    }
}
