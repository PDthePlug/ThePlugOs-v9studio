package com.theplugos.cashierhub.native

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

enum class LocalLinkAdvertisementState {
    STOPPED,
    STARTING,
    ACTIVE,
    UNAVAILABLE
}

data class LocalLinkAdvertisementSnapshot(
    val state: LocalLinkAdvertisementState,
    val serviceName: String? = null,
    val detail: String? = null
)

/**
 * Advertises a running pinned-TLS Hub over DNS-SD/mDNS. The advertisement is
 * discovery metadata only: a peer must still match the cloud-signed
 * fingerprint and pass the Hub's signed device challenge before it can send a
 * command.
 */
class HubLocalLinkAdvertiser(context: Context) {
    private val appContext = context.applicationContext
    private val nsd = appContext.getSystemService(NsdManager::class.java)
    private val wifi = appContext.getSystemService(WifiManager::class.java)
    private val multicastLock = wifi?.createMulticastLock("theplugos.hub-mdns.v1")?.apply {
        setReferenceCounted(false)
    }

    @Volatile
    private var snapshot = LocalLinkAdvertisementSnapshot(LocalLinkAdvertisementState.STOPPED)

    @Volatile
    private var registrationListener: NsdManager.RegistrationListener? = null

    fun start(hubDeviceId: String, certificateFingerprint: String, port: Int) {
        require(hubDeviceId.matches(DEVICE_ID)) { "The Hub device ID is invalid for local discovery." }
        require(certificateFingerprint.matches(FINGERPRINT)) { "The Hub certificate fingerprint is invalid for local discovery." }
        require(port in 1..65535) { "The Hub local discovery port is invalid." }
        stop()
        val serviceName = "ThePlugOS-" + shortHash(hubDeviceId)
        val serviceInfo = NsdServiceInfo().apply {
            serviceType = SERVICE_TYPE
            this.serviceName = serviceName
            this.port = port
            setAttribute("v", "1")
            setAttribute("hub", hubDeviceId)
            setAttribute("fp", certificateFingerprint)
            setAttribute("port", port.toString())
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                snapshot = LocalLinkAdvertisementSnapshot(
                    LocalLinkAdvertisementState.UNAVAILABLE,
                    serviceName,
                    "mDNS registration failed (code " + errorCode + ")."
                )
                registrationListener = null
                releaseMulticast()
            }

            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) {
                snapshot = LocalLinkAdvertisementSnapshot(
                    LocalLinkAdvertisementState.UNAVAILABLE,
                    serviceName,
                    "mDNS unregistration failed (code " + errorCode + ")."
                )
                registrationListener = null
                releaseMulticast()
            }

            override fun onServiceRegistered(info: NsdServiceInfo) {
                snapshot = LocalLinkAdvertisementSnapshot(LocalLinkAdvertisementState.ACTIVE, info.serviceName)
            }

            override fun onServiceUnregistered(info: NsdServiceInfo) {
                snapshot = LocalLinkAdvertisementSnapshot(LocalLinkAdvertisementState.STOPPED)
                registrationListener = null
                releaseMulticast()
            }
        }
        snapshot = LocalLinkAdvertisementSnapshot(LocalLinkAdvertisementState.STARTING, serviceName)
        registrationListener = listener
        try {
            acquireMulticast()
            nsd.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            registrationListener = null
            releaseMulticast()
            snapshot = LocalLinkAdvertisementSnapshot(
                LocalLinkAdvertisementState.UNAVAILABLE,
                serviceName,
                "mDNS advertising is unavailable on this Android network."
            )
        }
    }

    fun stop() {
        val listener = registrationListener
        registrationListener = null
        if (listener != null) {
            try {
                nsd.unregisterService(listener)
            } catch (_: Exception) {
                // The system may already have torn the registration down.
            }
        }
        releaseMulticast()
        if (snapshot.state != LocalLinkAdvertisementState.UNAVAILABLE) {
            snapshot = LocalLinkAdvertisementSnapshot(LocalLinkAdvertisementState.STOPPED)
        }
    }

    fun current(): LocalLinkAdvertisementSnapshot = snapshot

    private fun acquireMulticast() {
        try {
            if (multicastLock != null && !multicastLock.isHeld) multicastLock.acquire()
        } catch (_: Exception) {
            // mDNS may still work without an explicit multicast lock.
        }
    }

    private fun releaseMulticast() {
        try {
            if (multicastLock != null && multicastLock.isHeld) multicastLock.release()
        } catch (_: Exception) {
            // Nothing else is permitted to fail because a multicast lock could
            // not be released during a process/network teardown.
        }
    }

    private fun shortHash(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .take(6)
        .joinToString("") { byte -> "%02x".format(byte) }

    private companion object {
        const val SERVICE_TYPE = "_theplugos-hub._tcp."
        val DEVICE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
        val FINGERPRINT = Regex("^[0-9a-f]{64}$")
    }
}
