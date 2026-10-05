package com.theplugos.cashierhub

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.BridgeActivity
import com.theplugos.cashierhub.native.ThePlugOSLocalHubPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ThePlugOSLocalHubPlugin::class.java)
        super.onCreate(savedInstanceState)
        requestMeasuredLocalLinkPermissions()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == LOCAL_LINK_PERMISSION_REQUEST) {
            // The foreground service may have started before the user answered
            // Android's prompt. Re-attempt the already-verified discovery
            // layer; this does not enroll or trust any device.
            (application as ThePlugOSApplication).cashierHubRuntime.refreshLocalDiscovery()
        }
    }

    private fun requestMeasuredLocalLinkPermissions() {
        val needed = buildList {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                add(Manifest.permission.BLUETOOTH_ADVERTISE)
                add(Manifest.permission.BLUETOOTH_SCAN)
                add(Manifest.permission.BLUETOOTH_CONNECT)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                add(Manifest.permission.NEARBY_WIFI_DEVICES)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
        }.filter { permission ->
            ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), LOCAL_LINK_PERMISSION_REQUEST)
        }
    }

    private companion object {
        const val LOCAL_LINK_PERMISSION_REQUEST = 41053
    }
}
