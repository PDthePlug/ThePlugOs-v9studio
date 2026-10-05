package com.theplugos.cashierhub.native

import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 * Validates terminal proof, session scope, bundle freshness, revocation version,
 * and role permission before an operational command reaches the ledger.
 */
class HubCommandVerifier(
    private val database: HubDatabase,
    private val nowIso: () -> String
) {
    fun verify(command: OperationalCommand): VerifiedCommandContext {
        val bundle = database.activeAuthorizationBundle()
            ?: throw HubUnavailableException("This Hub is not enrolled with an active authorization bundle.")
        if (HubTime.isExpired(bundle.expiresAt, nowIso())) {
            throw HubUnavailableException("The local authorization bundle has expired. Reconnect the Hub for renewal before taking more orders.")
        }

        val device = database.pairedDevice(command.deviceId)
            ?: throw HubCommandRejectedException("This terminal is not paired with the Hub.")
        if (device.status != "ACTIVE" || device.revokedAt != null) {
            throw HubCommandRejectedException("This terminal is revoked or inactive.")
        }
        if (device.businessId != bundle.businessId || device.branchId != bundle.branchId) {
            throw HubCommandRejectedException("This terminal is not paired for the active business and branch.")
        }

        val session = database.staffSession(command.staffSessionId)
            ?: throw HubCommandRejectedException("The staff session is not active.")
        if (session.deviceId != device.deviceId || session.revokedAt != null || HubTime.isExpired(session.expiresAt, nowIso())) {
            throw HubCommandRejectedException("The staff session is expired, revoked, or bound to a different terminal.")
        }
        if (session.revocationVersion != bundle.revocationVersion) {
            throw HubCommandRejectedException("The staff session was created under an obsolete revocation version.")
        }
        // Sequence monotonicity is enforced inside the same SQLCipher
        // transaction that writes the receipt. Keeping it out of this
        // preflight permits an exact, signed retry to reach the receipt
        // idempotency boundary instead of being misclassified as stale.
        if (!isPermitted(session.role, command.type)) {
            throw HubCommandRejectedException("The verified ${session.role} session cannot execute ${command.type}.")
        }
        if (!verify(device.publicKeyBase64, command.canonicalBytes(), command.signature)) {
            throw HubCommandRejectedException("Terminal signature verification failed.")
        }

        return VerifiedCommandContext(
            businessId = bundle.businessId,
            branchId = bundle.branchId,
            deviceId = device.deviceId,
            staffId = session.staffId,
            staffSessionId = session.sessionId,
            role = session.role,
            authorizationBundleId = bundle.bundleId,
            revocationVersion = bundle.revocationVersion
        )
    }

    fun verifyTransportChallenge(deviceId: String, challenge: ByteArray, signatureBase64: String): Boolean {
        val bundle = database.activeAuthorizationBundle() ?: return false
        if (HubTime.isExpired(bundle.expiresAt, nowIso())) return false
        val device = database.pairedDevice(deviceId) ?: return false
        if (device.status != "ACTIVE" || device.revokedAt != null) return false
        if (device.businessId != bundle.businessId || device.branchId != bundle.branchId) return false
        if (device.role !in TERMINAL_OPERATIONAL_ROLES) return false
        return verify(device.publicKeyBase64, challenge, signatureBase64)
    }

    private fun verify(publicKeyBase64: String, message: ByteArray, signatureBase64: String): Boolean {
        return try {
            val publicKey: PublicKey = KeyFactory.getInstance("EC").generatePublic(
                X509EncodedKeySpec(HubWireEncoding.decode(publicKeyBase64, "Terminal public key"))
            )
            Signature.getInstance("SHA256withECDSA").run {
                initVerify(publicKey)
                update(message)
                verify(HubWireEncoding.decode(signatureBase64, "Terminal signature"))
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun isPermitted(role: String, type: String): Boolean {
        val permissions = when (role) {
            // Do not advertise future command families as usable authority.
            // The router and atomic contracts implement only the listed order
            // and cash-custody work; exact transition/payment ownership is
            // checked again by the domain router.
            "CASHIER" -> setOf("order.create", "order.status.transition", "payment.capture")
            "KITCHEN_STAFF" -> setOf("order.status.transition")
            "MANAGER" -> setOf("order.status.transition", "shift.open", "shift.close", "inventory.receive", "inventory.adjust", "inventory.waste")
            "OWNER", "ADMINISTRATOR" -> emptySet()
            else -> emptySet()
        }
        return type in permissions
    }

    private companion object {
        val TERMINAL_OPERATIONAL_ROLES = setOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
    }
}
