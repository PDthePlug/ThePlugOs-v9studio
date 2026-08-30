package com.theplugos.cashierhub.native

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import java.security.MessageDigest
import java.util.UUID

enum class BluetoothProximityState {
    STOPPED,
    STARTING,
    ACTIVE,
    UNAVAILABLE
}

data class BluetoothProximitySnapshot(
    val state: BluetoothProximityState,
    val detail: String? = null
)

/**
 * BLE is deliberately only a short proximity beacon. It advertises an opaque
 * deterministic hint for a Hub, never a pairing code, command, certificate,
 * session, or Bluetooth command channel. The terminal still has to resolve a
 * Wi-Fi LAN/Wi-Fi Direct endpoint and validate pinned TLS.
 */
class HubBluetoothProximityAdvertiser(private val context: Context) {
    @Volatile
    private var snapshot = BluetoothProximitySnapshot(BluetoothProximityState.STOPPED)

    @Volatile
    private var activeCallback: AdvertiseCallback? = null

    fun start(hubDeviceId: String, certificateFingerprint: String) {
        stop()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED
        ) {
            snapshot = BluetoothProximitySnapshot(
                BluetoothProximityState.UNAVAILABLE,
                "Bluetooth proximity permission has not been granted."
            )
            return
        }
        val adapter = BluetoothAdapter.getDefaultAdapter()
        if (adapter == null || !adapter.isEnabled) {
            snapshot = BluetoothProximitySnapshot(BluetoothProximityState.UNAVAILABLE, "Bluetooth is unavailable or disabled.")
            return
        }
        val advertiser = try {
            adapter.bluetoothLeAdvertiser
        } catch (_: Exception) {
            null
        }
        if (advertiser == null) {
            snapshot = BluetoothProximitySnapshot(BluetoothProximityState.UNAVAILABLE, "Bluetooth LE advertising is unavailable.")
            return
        }
        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings) {
                snapshot = BluetoothProximitySnapshot(BluetoothProximityState.ACTIVE)
            }

            override fun onStartFailure(errorCode: Int) {
                activeCallback = null
                snapshot = BluetoothProximitySnapshot(
                    BluetoothProximityState.UNAVAILABLE,
                    "Bluetooth proximity advertising failed (code " + errorCode + ")."
                )
            }
        }
        val proximityHint = MessageDigest.getInstance("SHA-256")
            .digest((hubDeviceId + ":" + certificateFingerprint).toByteArray(Charsets.UTF_8))
            .copyOfRange(0, PROXIMITY_HINT_BYTES)
        val data = AdvertiseData.Builder()
            .addServiceUuid(SERVICE_UUID)
            .addServiceData(SERVICE_UUID, byteArrayOf(PROTOCOL_VERSION) + proximityHint)
            .setIncludeDeviceName(false)
            .build()
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(false)
            .build()
        snapshot = BluetoothProximitySnapshot(BluetoothProximityState.STARTING)
        activeCallback = callback
        try {
            advertiser.startAdvertising(settings, data, callback)
        } catch (_: Exception) {
            activeCallback = null
            snapshot = BluetoothProximitySnapshot(BluetoothProximityState.UNAVAILABLE, "Bluetooth proximity advertising is unavailable.")
        }
    }

    fun stop() {
        val callback = activeCallback ?: run {
            if (snapshot.state != BluetoothProximityState.UNAVAILABLE) {
                snapshot = BluetoothProximitySnapshot(BluetoothProximityState.STOPPED)
            }
            return
        }
        activeCallback = null
        try {
            BluetoothAdapter.getDefaultAdapter()?.bluetoothLeAdvertiser?.stopAdvertising(callback)
        } catch (_: Exception) {
            // Process or adapter teardown can race a stop call.
        }
        if (snapshot.state != BluetoothProximityState.UNAVAILABLE) {
            snapshot = BluetoothProximitySnapshot(BluetoothProximityState.STOPPED)
        }
    }

    fun current(): BluetoothProximitySnapshot = snapshot

    companion object {
        val SERVICE_UUID: ParcelUuid = ParcelUuid(UUID.fromString("c25f0a12-4ddd-4e70-9815-dc5bbd01e528"))
        const val PROTOCOL_VERSION: Byte = 1
        const val PROXIMITY_HINT_BYTES = 8
    }
}
