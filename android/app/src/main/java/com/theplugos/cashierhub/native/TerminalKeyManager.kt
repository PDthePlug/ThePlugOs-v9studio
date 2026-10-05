package com.theplugos.cashierhub.native

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Native terminal identity. It is deliberately separate from the Hub identity
 * so a paired station cannot impersonate the branch authority. The private
 * P-256 key and the key used to encrypt its admission never leave Android
 * Keystore.
 */
class TerminalKeyManager(context: Context) {
    private val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    private val preferences = context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    fun terminalDeviceId(): String {
        val existing = preferences.getString(TERMINAL_DEVICE_ID, null)
        if (existing != null && existing.matches(DEVICE_ID)) return existing
        val generated = "terminal-" + UUID.randomUUID()
        check(preferences.edit().putString(TERMINAL_DEVICE_ID, generated).commit()) {
            "The terminal device ID could not be persisted."
        }
        return generated
    }

    fun signingPublicKeyBase64(): String = HubWireEncoding.encode(signingKeyPair().public.encoded)

    fun sign(bytes: ByteArray): String = HubWireEncoding.encode(
        Signature.getInstance("SHA256withECDSA").run {
            initSign(signingPrivateKey())
            update(bytes)
            sign()
        }
    )

    fun saveAdmission(envelopeJson: String) {
        require(envelopeJson.isNotBlank() && envelopeJson.length <= MAX_ADMISSION_CHARS) {
            "The signed terminal admission is invalid."
        }
        val encrypted = encrypt(envelopeJson.toByteArray(StandardCharsets.UTF_8))
        check(
            preferences.edit()
                .putString(ADMISSION_CIPHERTEXT, Base64.encodeToString(encrypted.ciphertext, Base64.NO_WRAP))
                .putString(ADMISSION_IV, Base64.encodeToString(encrypted.iv, Base64.NO_WRAP))
                .commit()
        ) {
            "The signed terminal admission could not be persisted."
        }
    }

    fun savedAdmission(): String? {
        val ciphertext = preferences.getString(ADMISSION_CIPHERTEXT, null) ?: return null
        val iv = preferences.getString(ADMISSION_IV, null) ?: return null
        return try {
            decrypt(
                Base64.decode(ciphertext, Base64.NO_WRAP),
                Base64.decode(iv, Base64.NO_WRAP)
            )
        } catch (_: Exception) {
            null
        }
    }

    fun clearAdmission() {
        preferences.edit().remove(ADMISSION_CIPHERTEXT).remove(ADMISSION_IV).commit()
    }

    /** The signed staff-session assertion is encrypted at rest independently
     * from the terminal admission. It contains no PIN or private key, but a
     * restart must retain the exact signed command intent/sequence so a retry
     * cannot silently become a new operational command. */
    fun saveStaffSession(session: TerminalStaffSession) {
        val serialized = session.toStorageJson().toString()
        require(serialized.length in 1..MAX_STAFF_SESSION_CHARS) {
            "The terminal staff session is invalid."
        }
        val encrypted = encrypt(serialized.toByteArray(StandardCharsets.UTF_8), staffSessionWrappingKey())
        check(
            preferences.edit()
                .putString(STAFF_SESSION_CIPHERTEXT, Base64.encodeToString(encrypted.ciphertext, Base64.NO_WRAP))
                .putString(STAFF_SESSION_IV, Base64.encodeToString(encrypted.iv, Base64.NO_WRAP))
                .commit()
        ) {
            "The terminal staff session could not be persisted."
        }
    }

    fun savedStaffSession(): TerminalStaffSession? {
        val ciphertext = preferences.getString(STAFF_SESSION_CIPHERTEXT, null) ?: return null
        val iv = preferences.getString(STAFF_SESSION_IV, null) ?: return null
        return try {
            val plaintext = decrypt(
                Base64.decode(ciphertext, Base64.NO_WRAP),
                Base64.decode(iv, Base64.NO_WRAP),
                staffSessionWrappingKey()
            )
            TerminalStaffSession.fromStorageJson(JSONObject(plaintext))
        } catch (_: Exception) {
            null
        }
    }

    fun clearStaffSession() {
        preferences.edit().remove(STAFF_SESSION_CIPHERTEXT).remove(STAFF_SESSION_IV).commit()
    }

    private fun signingKeyPair(): KeyPair {
        val existing = keyStore.getEntry(SIGNING_ALIAS, null) as? KeyStore.PrivateKeyEntry
        if (existing != null) return KeyPair(existing.certificate.publicKey, existing.privateKey)
        return KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE).run {
            initialize(
                KeyGenParameterSpec.Builder(
                    SIGNING_ALIAS,
                    KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
                )
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build()
            )
            generateKeyPair()
        }
    }

    private fun signingPrivateKey(): PrivateKey {
        signingKeyPair()
        return (keyStore.getEntry(SIGNING_ALIAS, null) as? KeyStore.PrivateKeyEntry)?.privateKey
            ?: error("The terminal signing key is unavailable.")
    }

    private fun admissionWrappingKey(): SecretKey {
        val existing = keyStore.getKey(ADMISSION_WRAP_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    ADMISSION_WRAP_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            generateKey()
        }
    }

    private fun staffSessionWrappingKey(): SecretKey {
        val existing = keyStore.getKey(STAFF_SESSION_WRAP_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    STAFF_SESSION_WRAP_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            generateKey()
        }
    }

    private fun encrypt(plaintext: ByteArray, wrappingKey: SecretKey = admissionWrappingKey()): EncryptedValue {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey)
        return EncryptedValue(cipher.doFinal(plaintext), cipher.iv)
    }

    private fun decrypt(ciphertext: ByteArray, iv: ByteArray, wrappingKey: SecretKey = admissionWrappingKey()): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, wrappingKey, GCMParameterSpec(128, iv))
        return String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
    }

    private data class EncryptedValue(val ciphertext: ByteArray, val iv: ByteArray)

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val PREFERENCES = "theplugos.branch-terminal.keystore"
        const val SIGNING_ALIAS = "theplugos.branch-terminal.signing.v1"
        const val ADMISSION_WRAP_ALIAS = "theplugos.branch-terminal.admission-wrap.v1"
        const val STAFF_SESSION_WRAP_ALIAS = "theplugos.branch-terminal.staff-session-wrap.v1"
        const val TERMINAL_DEVICE_ID = "terminal-device-id"
        const val ADMISSION_CIPHERTEXT = "terminal-admission-ciphertext"
        const val ADMISSION_IV = "terminal-admission-iv"
        const val STAFF_SESSION_CIPHERTEXT = "terminal-staff-session-ciphertext"
        const val STAFF_SESSION_IV = "terminal-staff-session-iv"
        const val MAX_ADMISSION_CHARS = 256 * 1024
        const val MAX_STAFF_SESSION_CHARS = 256 * 1024
        val DEVICE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
    }
}
