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
 *
 * A freshly enrolled terminal may request a one-time automatic handoff to the
 * native staff PIN screen as soon as the signed admission and local Hub link
 * are verified. The local-link checks are not skipped; only the extra merchant
 * button press is removed from the normal first-run journey.
 */
class NativeTerminalLocalLinkActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var controller: TerminalLocalLinkController
    private lateinit var cloud: TerminalCloudAuthorityClient
    private lateinit var status: TextView
    private var autoSignInRequested = false
    private var autoSignInLaunched = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        autoSignInRequested = intent.getBooleanExtra(EXTRA_AUTO_SIGN_IN, false)
        status = TextView(this).apply {
            text = if (autoSignInRequested) {
                "Connecting this enrolled device to your shop before staff sign-in."
            } else {
                "Checking the signed terminal admission before local discovery."
            }
        }
        val retry = Button(this).apply { text = "Retry local discovery" }
        val renew = Button(this).apply { text = "Renew cloud admission" }
        val staffSignIn = Button(this).apply { text = "Staff sign in" }
        val workspace = Button(this).apply { text = "Open workspace" }
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
        staffSignIn.setOnClickListener { openStaffSignIn() }
        workspace.setOnClickListener { startActivity(Intent(this, NativeTerminalOperationalWorkspaceActivity::class.java)) }
        setContentView(layout)

        val keys = TerminalKeyManager(applicationContext)
        cloud = TerminalCloudAuthorityClient(keys)
        controller = TerminalLocalLinkController(
            applicationContext,
            keys = keys,
            onSnapshot = { snapshot -> runOnUiThread { handleSnapshot(snapshot) } },
        )
        retry.setOnClickListener { controller.start() }
        renew.setOnClickListener {
            renew.isEnabled = false
            status.text = "Renewing this device's shop access…"
            executor.execute {
                val result = cloud.renewTerminalAdmission()
                runOnUiThread {
                    renew.isEnabled = true
                    if (result.installed) {
                        status.text = "Device access renewed. Reconnecting to your shop…"
                        controller.start()
                    } else {
                        status.text = result.error ?: "This device's shop access could not be renewed."
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

    private fun openStaffSignIn() {
        autoSignInLaunched = true
        startActivityForResult(Intent(this, NativeTerminalStaffSignInActivity::class.java), TERMINAL_SIGN_IN_REQUEST)
    }

    private fun handleSnapshot(snapshot: TerminalLocalLinkSnapshot) {
        status.text = statusText(snapshot)
        if (
            autoSignInRequested &&
            !autoSignInLaunched &&
            snapshot.state == TerminalLocalLinkState.AUTHENTICATED
        ) {
            autoSignInRequested = false
            openStaffSignIn()
        }
    }

    private fun statusText(snapshot: TerminalLocalLinkSnapshot): String = when (snapshot.state) {
        TerminalLocalLinkState.NOT_ENROLLED -> "This device needs a current shop invitation. ${snapshot.detail}"
        TerminalLocalLinkState.DISCOVERING -> "Finding your shop on the local network…"
        TerminalLocalLinkState.PROXIMITY_SEEN -> "Shop device found. Securing the connection…"
        TerminalLocalLinkState.ENDPOINT_RESOLVED -> "Shop device found. Securing the connection…"
        TerminalLocalLinkState.TLS_PINNING -> "Securing the connection…"
        TerminalLocalLinkState.CHALLENGED -> "Confirming this enrolled device…"
        TerminalLocalLinkState.AUTHENTICATED -> "Connected to your shop."
        TerminalLocalLinkState.STAFF_SESSION_ACTIVE -> "Staff session active."
        TerminalLocalLinkState.UNAVAILABLE -> "Your shop connection is unavailable. ${snapshot.detail}"
    }

    companion object {
        const val EXTRA_AUTO_SIGN_IN = "theplugos.extra.AUTO_STAFF_SIGN_IN"
        private const val TERMINAL_SIGN_IN_REQUEST = 480
    }
}