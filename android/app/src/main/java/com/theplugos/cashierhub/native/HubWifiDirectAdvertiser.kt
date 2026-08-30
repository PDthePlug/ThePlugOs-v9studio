package com.theplugos.cashierhub.native

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.p2p.WifiP2pManager
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceInfo
import android.os.Build

enum class WifiDirectAdvertisementState {
    STOPPED,
    STARTING,
    ACTIVE,
    UNAVAILABLE,
}

data class WifiDirectAdvertisementSnapshot(
    val state: WifiDirectAdvertisementState,
    val detail: String? = null,
)

/**
 * Makes the already-running pinned-TLS Hub discoverable through Android
 * Wi-Fi Direct DNS-SD.  The group and service record are transport plumbing;
 * terminal identity still requires the signed admission, TLS pin, and Hub
 * nonce proof implemented by the same local WebSocket protocol as LAN.
 */
class HubWifiDirectAdvertiser(context: Context) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(WifiP2pManager::class.java)

    @Volatile
    private var snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.STOPPED)

    @Volatile
    private var channel: WifiP2pManager.Channel? = null

    @Volatile
    private var serviceInfo: WifiP2pDnsSdServiceInfo? = null

    @Synchronized
    fun start(hubDeviceId: String, certificateFingerprint: String, port: Int) {
        stop()
        if (!hubDeviceId.matches(DEVICE_ID) || !certificateFingerprint.matches(FINGERPRINT) || port !in 1..65535) {
            snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.UNAVAILABLE, "Wi-Fi Direct discovery data is invalid.")
            return
        }
        if (!hasPermission()) {
            snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.UNAVAILABLE, "Wi-Fi Direct permission has not been granted.")
            return
        }
        val p2p = manager
        if (p2p == null) {
            snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.UNAVAILABLE, "Wi-Fi Direct is unavailable on this Android device.")
            return
        }
        val initialized = try {
            p2p.initialize(appContext, appContext.mainLooper) {
                snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.UNAVAILABLE, "Wi-Fi Direct channel was lost.")
                channel = null
                serviceInfo = null
            }
        } catch (_: Exception) {
            null
        }
        if (initialized == null) {
            snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.UNAVAILABLE, "Wi-Fi Direct could not be initialized.")
            return
        }
        val advertised = WifiP2pDnsSdServiceInfo.newInstance(
            SERVICE_INSTANCE,
            WIFI_DIRECT_SERVICE_TYPE,
            mapOf(
                "v" to "1",
                "hub" to hubDeviceId,
                "fp" to certificateFingerprint,
                "port" to port.toString(),
            ),
        )
        channel = initialized
        serviceInfo = advertised
        snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.STARTING)
        try {
            p2p.addLocalService(initialized, advertised, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
                    createGroup(p2p, initialized)
                }

                override fun onFailure(reason: Int) {
                    clearLocalService(p2p, initialized, advertised)
                    snapshot = WifiDirectAdvertisementSnapshot(
                        WifiDirectAdvertisementState.UNAVAILABLE,
                        "Wi-Fi Direct DNS-SD advertising failed (code $reason).",
                    )
                }
            })
        } catch (_: Exception) {
            clearLocalService(p2p, initialized, advertised)
            snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.UNAVAILABLE, "Wi-Fi Direct DNS-SD advertising is unavailable.")
        }
    }

    @Synchronized
    fun stop() {
        val p2p = manager
        val activeChannel = channel
        val activeService = serviceInfo
        channel = null
        serviceInfo = null
        if (p2p != null && activeChannel != null) {
            if (activeService != null) clearLocalService(p2p, activeChannel, activeService)
            runCatching {
                p2p.removeGroup(activeChannel, object : WifiP2pManager.ActionListener {
                    override fun onSuccess() = Unit
                    override fun onFailure(reason: Int) = Unit
                })
            }
        }
        if (snapshot.state != WifiDirectAdvertisementState.UNAVAILABLE) {
            snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.STOPPED)
        }
    }

    fun current(): WifiDirectAdvertisementSnapshot = snapshot

    private fun createGroup(p2p: WifiP2pManager, activeChannel: WifiP2pManager.Channel) {
        try {
            p2p.createGroup(activeChannel, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
                    snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.ACTIVE)
                }

                override fun onFailure(reason: Int) {
                    snapshot = WifiDirectAdvertisementSnapshot(
                        WifiDirectAdvertisementState.UNAVAILABLE,
                        "Wi-Fi Direct group creation failed (code $reason).",
                    )
                }
            })
        } catch (_: Exception) {
            snapshot = WifiDirectAdvertisementSnapshot(WifiDirectAdvertisementState.UNAVAILABLE, "Wi-Fi Direct group creation is unavailable.")
        }
    }

    private fun clearLocalService(p2p: WifiP2pManager, activeChannel: WifiP2pManager.Channel, activeService: WifiP2pDnsSdServiceInfo) {
        runCatching {
            p2p.removeLocalService(activeChannel, activeService, object : WifiP2pManager.ActionListener {
                override fun onSuccess() = Unit
                override fun onFailure(reason: Int) = Unit
            })
        }
    }

    private fun hasPermission(): Boolean = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
            appContext.checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ->
            appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        else -> true
    }

    private companion object {
        const val SERVICE_INSTANCE = "ThePlugOS"
        const val WIFI_DIRECT_SERVICE_TYPE = "_theplugos-hub._tcp"
        val DEVICE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$")
        val FINGERPRINT = Regex("^[0-9a-f]{64}$")
    }
}
