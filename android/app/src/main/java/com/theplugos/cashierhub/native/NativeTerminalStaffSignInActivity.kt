package com.theplugos.cashierhub.native

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import java.util.concurrent.Executors

/**
 * Native terminal-only fresh PIN surface. It deliberately waits for the
 * measured local Hub link before exposing the role-filtered roster; neither a
 * browser nor a BLE advertisement may choose staff or create a session.
 */
class NativeTerminalStaffSignInActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var controller: TerminalLocalLinkController
    private lateinit var cloud: TerminalCloudAuthorityClient
    private lateinit var status: TextView
    private lateinit var staffSpinner: Spinner
    private lateinit var pin: EditText
    private lateinit var signIn: Button
    private lateinit var adapter: ArrayAdapter<String>
    private var staff: List<StaffDirectoryRecord> = emptyList()
    private var directoryRequested = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        status = TextView(this).apply { text = "Authenticating the admitted Hub before native staff sign-in." }
        staffSpinner = Spinner(this)
        adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, mutableListOf("Waiting for authenticated Hub"))
        staffSpinner.adapter = adapter
        pin = EditText(this).apply {
            hint = "Staff PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        signIn = Button(this).apply { text = "Start terminal staff session" }
        val close = Button(this).apply { text = "Close" }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            addView(status)
            addView(staffSpinner)
            addView(pin)
            addView(signIn)
            addView(close)
        }
        setContentView(layout)

        staffSpinner.isEnabled = false
        pin.isEnabled = false
        signIn.isEnabled = false
        val keys = TerminalKeyManager(applicationContext)
        cloud = TerminalCloudAuthorityClient(keys)
        controller = TerminalLocalLinkController(
            applicationContext,
            keys = keys,
            onSnapshot = { snapshot -> onLinkSnapshot(snapshot) },
        )
        signIn.setOnClickListener { startStaffSession() }
        close.setOnClickListener { finish() }
        controller.start()
    }

    override fun onDestroy() {
        if (::controller.isInitialized) controller.stop()
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun onLinkSnapshot(snapshot: TerminalLocalLinkSnapshot) {
        status.text = when (snapshot.state) {
            TerminalLocalLinkState.NOT_ENROLLED -> "A current terminal admission is required. ${snapshot.detail}"
            TerminalLocalLinkState.DISCOVERING -> "Discovering admitted Hub. ${snapshot.detail}"
            TerminalLocalLinkState.PROXIMITY_SEEN -> "Bluetooth proximity measured. ${snapshot.detail}"
            TerminalLocalLinkState.ENDPOINT_RESOLVED -> "Local endpoint resolved. ${snapshot.detail}"
            TerminalLocalLinkState.TLS_PINNING -> "Verifying pinned TLS. ${snapshot.detail}"
            TerminalLocalLinkState.CHALLENGED -> "Proving terminal identity. ${snapshot.detail}"
            TerminalLocalLinkState.AUTHENTICATED -> "Authenticated Hub link active. Loading the permitted native staff roster."
            TerminalLocalLinkState.STAFF_SESSION_ACTIVE -> "Terminal staff session active. ${snapshot.detail}"
            TerminalLocalLinkState.UNAVAILABLE -> "Terminal staff sign-in unavailable. ${snapshot.detail}"
        }
        if (snapshot.state == TerminalLocalLinkState.AUTHENTICATED && !directoryRequested) {
            directoryRequested = true
            controller.requestTerminalStaffDirectory { roster, error ->
                if (roster == null || error != null || roster.isEmpty()) {
                    directoryRequested = false
                    status.text = error ?: "No active staff member is eligible for this terminal role."
                    return@requestTerminalStaffDirectory
                }
                staff = roster
                adapter.clear()
                adapter.addAll(roster.map { it.name })
                adapter.notifyDataSetChanged()
                staffSpinner.isEnabled = true
                pin.isEnabled = true
                signIn.isEnabled = true
                status.text = "Select staff and enter the PIN on this native terminal."
            }
        }
        if (snapshot.state !in setOf(TerminalLocalLinkState.AUTHENTICATED, TerminalLocalLinkState.STAFF_SESSION_ACTIVE)) {
            staffSpinner.isEnabled = false
            pin.isEnabled = false
            signIn.isEnabled = false
        }
    }

    private fun startStaffSession() {
        val selected = staff.getOrNull(staffSpinner.selectedItemPosition) ?: return
        val nativePin = pin.text.toString().toCharArray()
        pin.text?.clear()
        if (nativePin.size !in 4..8 || !nativePin.all(Char::isDigit)) {
            nativePin.fill('\u0000')
            status.text = "Enter a 4 to 8 digit staff PIN."
            return
        }
        signIn.isEnabled = false
        status.text = "Verifying the staff PIN with cloud authority and terminal-key proof…"
        executor.execute {
            val result = cloud.startTerminalStaffSession(selected.staffId, nativePin)
            runOnUiThread {
                if (!result.installed || result.session == null) {
                    signIn.isEnabled = true
                    status.text = result.error ?: "The terminal staff session could not be started."
                    return@runOnUiThread
                }
                status.text = "Installing the verified staff session on the authenticated Hub…"
                controller.installTerminalStaffSession(org.json.JSONObject(result.session.envelopeJson)) { installed ->
                    if (installed.installed && installed.sessionId == result.session.sessionId) {
                        status.text = "Terminal staff session active until ${installed.expiresAt}."
                        pin.isEnabled = false
                        signIn.isEnabled = false
                    } else {
                        cloud.clearTerminalStaffSession()
                        signIn.isEnabled = true
                        status.text = installed.error ?: "The Hub did not accept the terminal staff session."
                    }
                }
            }
        }
    }
}
