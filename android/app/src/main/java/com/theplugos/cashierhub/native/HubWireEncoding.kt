package com.theplugos.cashierhub.native

import android.util.Base64

/**
 * Strict base64url for every signed protocol field. Android's Base64 decoder
 * otherwise accepts both alphabets and padding, which would make a native
 * parser more permissive than the cloud protocol.
 */
object HubWireEncoding {
    private val base64Url = Regex("^[A-Za-z0-9_-]+$")

    fun encode(bytes: ByteArray): String = Base64.encodeToString(
        bytes,
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
    )

    fun decode(value: String, subject: String): ByteArray {
        if (value.isEmpty() || !base64Url.matches(value) || value.length % 4 == 1) {
            throw HubCommandRejectedException("$subject is not valid base64url data.")
        }
        return try {
            Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            throw HubCommandRejectedException("$subject is not valid base64url data.")
        }
    }
}
