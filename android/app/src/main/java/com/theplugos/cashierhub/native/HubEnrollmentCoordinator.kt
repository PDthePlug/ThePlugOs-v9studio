package com.theplugos.cashierhub.native

import com.theplugos.cashierhub.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

/** Public enrollment proof sent only to the cloud enrollment receiver. */
data class HubEnrollmentProof(
    val signingPublicKeyBase64: String,
    val tlsCertificateBase64: String,
    val tlsCertificateSha256: String
)

interface AuthorizationBundleIssuerKeyResolver {
    /** X.509 SubjectPublicKeyInfo, base64 encoded, selected by immutable key ID. */
    fun resolve(issuerKeyId: String): String?
}

/**
 * Release builds pin issuer public keys through BuildConfig. A missing or
 * malformed key never falls back to a cloud-provided key.
 */
class BuildConfigIssuerKeyResolver : AuthorizationBundleIssuerKeyResolver {
    override fun resolve(issuerKeyId: String): String? = try {
        JSONObject(BuildConfig.HUB_AUTHORIZATION_ISSUER_KEYS_JSON)
            .optString(issuerKeyId, "")
            .trim()
            .ifEmpty { null }
    } catch (_: Exception) {
        null
    }
}

data class EnrollmentInstallResult(
    val installed: Boolean,
    val bundleId: String? = null,
    val error: String? = null,
    /** A verified bundle is usable by the Hub's own native station even if
     * the optional paired-terminal listener cannot bind right now. */
    val warning: String? = null
)

/**
 * Accepts a signed cloud bundle only after it has been downloaded by a native
 * HTTPS enrollment flow. This class deliberately has no Capacitor plugin
 * method: a browser cannot inject or activate local authority.
 */
class HubEnrollmentCoordinator(
    private val runtime: CashierHubRuntime,
    private val issuerKeys: AuthorizationBundleIssuerKeyResolver = BuildConfigIssuerKeyResolver()
) {
    fun enrollmentProof(): HubEnrollmentProof = runtime.enrollmentProof()

    fun installSignedBundle(envelope: JSONObject): EnrollmentInstallResult {
        return try {
            val bundle = verifyEnvelope(envelope)
            runtime.installVerifiedAuthorizationBundle(bundle)
            val transportWarning = try {
                runtime.startVerifiedLocalTransport()
                null
            } catch (error: Exception) {
                val detail = error.message ?: "local listener did not start."
                "The native Hub was enrolled, but paired-device transport is unavailable: $detail"
            }
            EnrollmentInstallResult(installed = true, bundleId = bundle.bundleId, warning = transportWarning)
        } catch (error: IllegalStateException) {
            EnrollmentInstallResult(installed = false, error = error.message ?: "The authorization bundle could not be installed.")
        } catch (_: Exception) {
            EnrollmentInstallResult(installed = false, error = "The authorization bundle could not be verified.")
        }
    }

    private fun verifyEnvelope(envelope: JSONObject): VerifiedAuthorizationBundle {
        if (envelope.optInt("schemaVersion", -1) != 1) {
            throw HubCommandRejectedException("The authorization bundle envelope schema is not supported.")
        }
        val issuerKeyId = envelope.requiredNonBlank("issuerKeyId", "Authorization bundle issuer key ID")
        val payloadBase64 = envelope.requiredNonBlank("payloadBase64", "Authorization bundle payload")
        val signature = envelope.requiredNonBlank("signature", "Authorization bundle signature")
        if (payloadBase64.length > MAX_BUNDLE_PAYLOAD_BASE64_CHARS) {
            throw HubCommandRejectedException("The authorization bundle payload is too large.")
        }

        val payloadBytes = try {
            HubWireEncoding.decode(payloadBase64, "The authorization bundle payload")
        } catch (_: IllegalStateException) {
            throw HubCommandRejectedException("The authorization bundle payload encoding is invalid.")
        }
        if (payloadBytes.isEmpty() || payloadBytes.size > MAX_BUNDLE_PAYLOAD_BYTES) {
            throw HubCommandRejectedException("The authorization bundle payload is too large.")
        }
        val issuerKey = issuerKeys.resolve(issuerKeyId)
            ?: throw HubCommandRejectedException("This application does not trust the authorization bundle issuer.")
        if (!verifySignature(issuerKey, payloadBytes, signature)) {
            throw HubCommandRejectedException("The authorization bundle signature is invalid.")
        }

        val payloadJson = try {
            String(payloadBytes, Charsets.UTF_8)
        } catch (_: Exception) {
            throw HubCommandRejectedException("The authorization bundle payload is not UTF-8.")
        }
        val payload = try {
            JSONObject(payloadJson)
        } catch (_: Exception) {
            throw HubCommandRejectedException("The authorization bundle payload is not a JSON object.")
        }
        if (payload.optInt("schemaVersion", -1) != 1) {
            throw HubCommandRejectedException("The authorization bundle payload schema is not supported.")
        }

        val bundleId = payload.requiredUuid("bundleId", "Authorization bundle ID")
        val businessId = payload.requiredUuid("businessId", "Authorization business ID")
        val branchId = payload.requiredUuid("branchId", "Authorization branch ID")
        val hubDeviceId = payload.requiredDeviceId("hubDeviceId", "Authorization Hub device ID")
        val hubSigningPublicKey = payload.requiredNonBlank("hubSigningPublicKeyBase64", "Authorization Hub signing key")
        val hubTlsFingerprint = payload.requiredFingerprint("hubTlsCertificateSha256")
        val issuedAt = payload.requiredNonBlank("issuedAt", "Authorization issue time")
        val expiresAt = payload.requiredNonBlank("expiresAt", "Authorization expiry")
        val revocationVersion = payload.requiredNonNegativeLong("revocationVersion")
        HubTime.requireCanonicalUtc(issuedAt, "Authorization issue time")
        HubTime.requireCanonicalUtc(expiresAt, "Authorization expiry")
        if (HubTime.isExpired(expiresAt, issuedAt)) {
            throw HubCommandRejectedException("The authorization bundle is already expired.")
        }

        val localProof = runtime.enrollmentProof()
        if (hubDeviceId != runtime.hubDeviceIdForCloud()) {
            throw HubCommandRejectedException("The authorization bundle is bound to a different Hub device identity.")
        }
        if (hubSigningPublicKey != localProof.signingPublicKeyBase64) {
            throw HubCommandRejectedException("The authorization bundle is bound to a different Hub signing key.")
        }
        if (hubTlsFingerprint != localProof.tlsCertificateSha256) {
            throw HubCommandRejectedException("The authorization bundle is bound to a different Hub TLS certificate.")
        }

        val pairedDevices = parsePairedDevices(payload.optJSONArray("pairedDevices"))
        val hubRecord = pairedDevices.singleOrNull { it.deviceId == hubDeviceId }
            ?: throw HubCommandRejectedException("The authorization bundle does not include its Hub device record.")
        if (hubRecord.publicKeyBase64 != hubSigningPublicKey) {
            throw HubCommandRejectedException("The authorization bundle Hub device record does not match its signing key.")
        }

        val staffDirectory = parseStaffDirectory(payload.optJSONArray("staffDirectory"))
        val staffSessions = parseStaffSessions(payload.optJSONArray("staffSessions"), revocationVersion)
        if (staffSessions.any { session -> staffDirectory.none { it.staffId == session.staffId } }) {
            throw HubCommandRejectedException("The authorization bundle has a session outside its signed staff directory.")
        }
        val configuration = parseConfiguration(payload.optJSONObject("configuration"), branchId)
        return VerifiedAuthorizationBundle(
            bundleId = bundleId,
            businessId = businessId,
            branchId = branchId,
            hubDeviceId = hubDeviceId,
            issuerKeyId = issuerKeyId,
            issuedAt = issuedAt,
            expiresAt = expiresAt,
            revocationVersion = revocationVersion,
            payloadJson = payloadJson,
            signature = signature,
            tlsMaterialJson = JSONObject().put("hubTlsCertificateSha256", hubTlsFingerprint).toString(),
            pairedDevices = pairedDevices,
            staffDirectory = staffDirectory,
            staffSessions = staffSessions,
            configuration = configuration
        )
    }

    private fun parsePairedDevices(values: JSONArray?): List<BundlePairedDevice> {
        if (values == null || values.length() == 0 || values.length() > MAX_PAIRED_DEVICES) {
            throw HubCommandRejectedException("The authorization bundle has no valid paired-device list.")
        }
        return buildList {
            for (index in 0 until values.length()) {
                val value = values.optJSONObject(index)
                    ?: throw HubCommandRejectedException("The authorization bundle has an invalid paired-device record.")
                val role = value.requiredRole("role", "Paired-device role")
                val connectionType = value.requiredNonBlank("connectionType", "Paired-device connection type")
                if (connectionType != "LAN_WIFI") throw HubCommandRejectedException("The authorization bundle contains an unsupported paired-device connection type.")
                add(
                    BundlePairedDevice(
                        deviceId = value.requiredDeviceId("deviceId", "Paired-device ID"),
                        name = value.requiredNonBlank("name", "Paired-device name"),
                        role = role,
                        publicKeyBase64 = value.requiredNonBlank("publicKeyBase64", "Paired-device public key"),
                        connectionType = connectionType
                    )
                )
            }
        }
    }

    private fun parseStaffSessions(values: JSONArray?, expectedRevocationVersion: Long): List<BundleStaffSession> {
        if (values == null || values.length() > MAX_STAFF_SESSIONS) {
            throw HubCommandRejectedException("The authorization bundle has an invalid staff-session list.")
        }
        return buildList {
            for (index in 0 until values.length()) {
                val value = values.optJSONObject(index)
                    ?: throw HubCommandRejectedException("The authorization bundle has an invalid staff-session record.")
                val revocationVersion = value.requiredNonNegativeLong("revocationVersion")
                if (revocationVersion != expectedRevocationVersion) {
                    throw HubCommandRejectedException("The authorization bundle has a staff session from another revocation version.")
                }
                val expiresAt = value.requiredNonBlank("expiresAt", "Staff-session expiry")
                HubTime.requireCanonicalUtc(expiresAt, "Staff-session expiry")
                add(
                    BundleStaffSession(
                        sessionId = value.requiredUuid("sessionId", "Staff-session ID"),
                        staffId = value.requiredUuid("staffId", "Staff ID"),
                        deviceId = value.requiredDeviceId("deviceId", "Staff-session device ID"),
                        role = value.requiredRole("role", "Staff-session role"),
                        expiresAt = expiresAt,
                        revocationVersion = revocationVersion
                    )
                )
            }
        }
    }

    private fun parseStaffDirectory(values: JSONArray?): List<BundleStaffDirectoryEntry> {
        if (values == null || values.length() > MAX_STAFF_DIRECTORY) {
            throw HubCommandRejectedException("The authorization bundle has an invalid staff directory.")
        }
        val staffIds = mutableSetOf<String>()
        return buildList {
            for (index in 0 until values.length()) {
                val value = values.optJSONObject(index)
                    ?: throw HubCommandRejectedException("The authorization bundle has an invalid staff-directory record.")
                val staffId = value.requiredUuid("staffId", "Staff-directory ID")
                if (!staffIds.add(staffId)) throw HubCommandRejectedException("The authorization bundle has duplicate staff-directory IDs.")
                add(
                    BundleStaffDirectoryEntry(
                        staffId = staffId,
                        name = value.requiredNonBlank("name", "Staff-directory name"),
                        role = value.requiredRole("role", "Staff-directory role")
                    )
                )
            }
        }
    }

    private fun parseConfiguration(value: JSONObject?, expectedBranchId: String): BundleConfigurationSnapshot {
        if (value == null) throw HubCommandRejectedException("The authorization bundle has no configuration snapshot.")
        val vat = value.optJSONObject("vat")
            ?: throw HubCommandRejectedException("The authorization bundle has no VAT configuration.")
        if (!vat.has("enabled")) throw HubCommandRejectedException("The authorization bundle VAT configuration is incomplete.")
        val vatEnabled = vat.optBoolean("enabled", false)
        val vatRate = vat.optDouble("rate", Double.NaN)
        if (!vatRate.isFinite() || vatRate < 0.0 || vatRate > 100.0) {
            throw HubCommandRejectedException("The authorization bundle VAT rate is invalid.")
        }

        val products = value.optJSONArray("catalogProducts")
            ?: throw HubCommandRejectedException("The authorization bundle has no catalog snapshot.")
        if (products.length() > MAX_CATALOG_PRODUCTS) {
            throw HubCommandRejectedException("The authorization bundle catalog is too large.")
        }
        val productIds = mutableSetOf<String>()
        val catalogProducts = buildList {
            for (index in 0 until products.length()) {
                val product = products.optJSONObject(index)
                    ?: throw HubCommandRejectedException("The authorization bundle has an invalid catalog product.")
                val productId = product.requiredUuid("id", "Catalog product ID")
                if (!productIds.add(productId)) throw HubCommandRejectedException("The authorization bundle has duplicate catalog product IDs.")
                val price = product.requiredFiniteNonNegative("price", "Catalog product price")
                val stockQuantity = product.requiredFiniteNonNegative(
                    if (product.has("stockQuantity")) "stockQuantity" else "stock",
                    "Catalog product stock quantity"
                )
                val productBranchId = product.optString("branchId", "").trim().ifEmpty { null }?.let { candidate ->
                    try {
                        UUID.fromString(candidate).toString()
                    } catch (_: IllegalArgumentException) {
                        throw HubCommandRejectedException("The authorization bundle catalog has an invalid branch ID.")
                    }
                }
                if (productBranchId != null && productBranchId != expectedBranchId) {
                    throw HubCommandRejectedException("The authorization bundle catalog contains another branch's product.")
                }
                val status = product.optString("status", "ACTIVE").trim()
                if (status !in setOf("ACTIVE", "ARCHIVED")) {
                    throw HubCommandRejectedException("The authorization bundle catalog has an unsupported product status.")
                }
                add(
                    BundleCatalogProduct(
                        productId = productId,
                        name = product.requiredNonBlank("name", "Catalog product name"),
                        category = product.requiredNonBlank("category", "Catalog product category"),
                        price = price,
                        stockQuantity = stockQuantity,
                        unit = product.requiredNonBlank("unit", "Catalog product unit"),
                        branchId = productBranchId,
                        status = status
                    )
                )
            }
        }
        return BundleConfigurationSnapshot(vatEnabled, vatRate, catalogProducts)
    }

    private fun verifySignature(publicKeyBase64: String, payload: ByteArray, signatureBase64: String): Boolean = try {
        val publicKey: PublicKey = KeyFactory.getInstance("EC").generatePublic(
            X509EncodedKeySpec(HubWireEncoding.decode(publicKeyBase64, "Authorization issuer public key"))
        )
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey)
            update(payload)
            verify(HubWireEncoding.decode(signatureBase64, "Authorization bundle signature"))
        }
    } catch (_: Exception) {
        false
    }

    private fun JSONObject.requiredNonBlank(name: String, subject: String): String {
        val value = optString(name, "").trim()
        if (value.isEmpty() || value.length > MAX_FIELD_CHARS) throw HubCommandRejectedException("$subject is required.")
        return value
    }

    private fun JSONObject.requiredUuid(name: String, subject: String): String {
        val value = requiredNonBlank(name, subject)
        return try {
            UUID.fromString(value).toString()
        } catch (_: IllegalArgumentException) {
            throw HubCommandRejectedException("$subject must be a UUID.")
        }
    }

    private fun JSONObject.requiredDeviceId(name: String, subject: String): String {
        val value = requiredNonBlank(name, subject)
        if (!value.matches(Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$"))) {
            throw HubCommandRejectedException("$subject is invalid.")
        }
        return value
    }

    private fun JSONObject.requiredFingerprint(name: String): String {
        val value = requiredNonBlank(name, "Hub TLS certificate fingerprint").lowercase()
        if (!value.matches(Regex("^[0-9a-f]{64}$"))) throw HubCommandRejectedException("Hub TLS certificate fingerprint is invalid.")
        return value
    }

    private fun JSONObject.requiredNonNegativeLong(name: String): Long {
        if (!has(name)) throw HubCommandRejectedException("Authorization $name is required.")
        val value = optLong(name, -1L)
        if (value < 0L) throw HubCommandRejectedException("Authorization $name must be a non-negative integer.")
        return value
    }

    private fun JSONObject.requiredFiniteNonNegative(name: String, subject: String): Double {
        if (!has(name)) throw HubCommandRejectedException("$subject is required.")
        val value = optDouble(name, Double.NaN)
        if (!value.isFinite() || value < 0.0) throw HubCommandRejectedException("$subject must be a finite non-negative number.")
        return value
    }

    private fun JSONObject.requiredRole(name: String, subject: String): String {
        val value = requiredNonBlank(name, subject)
        if (value !in ROLES) throw HubCommandRejectedException("$subject is not supported.")
        return value
    }

    private companion object {
        const val MAX_BUNDLE_PAYLOAD_BYTES = 256 * 1024
        const val MAX_BUNDLE_PAYLOAD_BASE64_CHARS = 350 * 1024
        const val MAX_FIELD_CHARS = 2048
        const val MAX_PAIRED_DEVICES = 64
        const val MAX_STAFF_SESSIONS = 256
        const val MAX_STAFF_DIRECTORY = 256
        const val MAX_CATALOG_PRODUCTS = 5_000
        val ROLES = setOf("CASHIER", "KITCHEN_STAFF", "MANAGER", "OWNER", "ADMINISTRATOR")
    }
}
