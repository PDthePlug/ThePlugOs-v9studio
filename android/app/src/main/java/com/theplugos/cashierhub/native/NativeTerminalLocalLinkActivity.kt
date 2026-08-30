package com.theplugos.cashierhub.native

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.concurrent.Executors

/**
 * Native-only measured local-link surface for an already enrolled terminal.
 * It displays connection facts but deliberately does not accept PINs, browser
 * input, or operational command payloads.
 */
class NativeTerminalLocalLinkActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var controller: TerminalLocalLinkController
    private lateinit var cloud: TerminalCloudAuthorityClient
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = TextView(this).apply {
            text = "Checking the signed terminal admission before local discovery."
        }
        val retry = Button(this).apply { text = "Retry local discovery" }
        val renew = Button(this).apply { text = "Renew cloud admission" }
        val staffSignIn = Button(this).apply { text = "Native terminal staff sign-in" }
        val workspace = Button(this).apply { text = "Open terminal workspace" }
        val close = Button(this).apply { text = "Close" }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            addView(status)
            addView(retry)
            addView(renew)
            addView(staffSignIn)
            addView(workspace)
            addView(close)
        }
        staffSignIn.setOnClickListener {
            startActivityForResult(Intent(this, NativeTerminalStaffSignInActivity::class.java), TERMINAL_SIGN_IN_REQUEST)
        }
        workspace.setOnClickListener { startActivity(Intent(this, NativeTerminalOperationalWorkspaceActivity::class.java)) }
        setContentView(layout)

        val keys = TerminalKeyManager(applicationContext)
        cloud = TerminalCloudAuthorityClient(keys)
        controller = TerminalLocalLinkController(
            applicationContext,
            keys = keys,
            onSnapshot = { snapshot -> status.text = statusText(snapshot) },
        )
        retry.setOnClickListener { controller.start() }
        renew.setOnClickListener {
            renew.isEnabled = false
            status.text = "Renewing the terminal admission with the Android Keystore key…"
            executor.execute {
                val result = cloud.renewTerminalAdmission()
                runOnUiThread {
                    renew.isEnabled = true
                    if (result.installed) {
                        status.text = "Cloud admission renewed. Restarting measured local discovery."
                        controller.start()
                    } else {
                        status.text = result.error ?: "The terminal admission could not be renewed."
                    }
                }
            }
        }
        close.setOnClickListener { finish() }
        controller.start()
    }

    override fun onDestroy() {
        if (::controller.isInitialized) controller.stop()
        executor.shutdownNow()
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == TERMINAL_SIGN_IN_REQUEST && resultCode == RESULT_OK) {
            startActivity(Intent(this, NativeTerminalOperationalWorkspaceActivity::class.java))
        }
    }

    private fun statusText(snapshot: TerminalLocalLinkSnapshot): String = when (snapshot.state) {
        TerminalLocalLinkState.NOT_ENROLLED -> "Terminal admission required. ${snapshot.detail}"
        TerminalLocalLinkState.DISCOVERING -> "Discovering admitted Hub. ${snapshot.detail}"
        TerminalLocalLinkState.PROXIMITY_SEEN -> "Bluetooth proximity measured. ${snapshot.detail}"
        TerminalLocalLinkState.ENDPOINT_RESOLVED -> "Local endpoint resolved. ${snapshot.detail}"
        TerminalLocalLinkState.TLS_PINNING -> "Verifying pinned TLS. ${snapshot.detail}"
        TerminalLocalLinkState.CHALLENGED -> "Proving terminal identity. ${snapshot.detail}"
        TerminalLocalLinkState.AUTHENTICATED -> "Authenticated local link active over ${snapshot.transport ?: "local network"}. ${snapshot.detail}"
        TerminalLocalLinkState.STAFF_SESSION_ACTIVE -> "Verified terminal staff session active over ${snapshot.transport ?: "local network"}. ${snapshot.detail}"
        TerminalLocalLinkState.UNAVAILABLE -> "Local link unavailable. ${snapshot.detail}"
    }

    private companion object {
        const val TERMINAL_SIGN_IN_REQUEST = 480
    }
}
