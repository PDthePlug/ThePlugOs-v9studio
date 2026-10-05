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
import android.widget.Toast
import java.util.concurrent.Executors

/**
 * Native terminal-only fresh PIN surface. It deliberately waits for the
 * measured local Hub link before exposing the role-filtered roster; neither a
 * browser nor a BLE advertisement may choose staff or create a session.
 *
 * On successful verification this Activity returns RESULT_OK to the admitted
 * terminal flow, which immediately opens the role-minimized operational
 * workspace. No PIN or staff-session bearer is returned to React.
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
        status = TextView(this).apply { text = "Connecting to your shop…" }
        staffSpinner = Spinner(this)
        adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, mutableListOf("Loading staff profiles…"))
        staffSpinner.adapter = adapter
        pin = EditText(this).apply {
            hint = "Staff PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        signIn = Button(this).apply {
            text = "Sign in & open workspace"
            isAllCaps = false
        }
        val close = Button(this).apply {
            text = "Back"
            isAllCaps = false
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            addView(TextView(this@NativeTerminalStaffSignInActivity).apply {
                text = "ThePlugOS\nWho’s working this station?"
                textSize = 26f
                setPadding(0, 0, 0, 28)
            })
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
            TerminalLocalLinkState.NOT_ENROLLED -> "This device needs to be enrolled before staff can sign in."
            TerminalLocalLinkState.DISCOVERING -> "Finding your shop on the local network…"
            TerminalLocalLinkState.PROXIMITY_SEEN -> "Shop device found. Securing the connection…"
            TerminalLocalLinkState.ENDPOINT_RESOLVED -> "Shop device found. Securing the connection…"
            TerminalLocalLinkState.TLS_PINNING -> "Securing the connection…"
            TerminalLocalLinkState.CHALLENGED -> "Confirming this enrolled device…"
            TerminalLocalLinkState.AUTHENTICATED -> "Connected. Loading the staff profiles allowed on this station…"
            TerminalLocalLinkState.STAFF_SESSION_ACTIVE -> "Staff session active. Opening your workspace…"
            TerminalLocalLinkState.UNAVAILABLE -> "The shop connection is unavailable. Check that the main shop device is running and try again."
        }
        if (snapshot.state == TerminalLocalLinkState.AUTHENTICATED && !directoryRequested) {
            directoryRequested = true
            controller.requestTerminalStaffDirectory { roster, error ->
                if (roster == null || error != null || roster.isEmpty()) {
                    directoryRequested = false
                    status.text = error ?: "No active staff profile is available for this station."
                    return@requestTerminalStaffDirectory
                }
                staff = roster
                adapter.clear()
                adapter.addAll(roster.map { "${it.name} (${friendlyRole(it.role)})" })
                adapter.notifyDataSetChanged()
                staffSpinner.isEnabled = true
                pin.isEnabled = true
                signIn.isEnabled = true
                status.text = "Choose your name and enter your PIN."
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
            status.text = "Enter your 4 to 8 digit staff PIN."
            return
        }
        signIn.isEnabled = false
        status.text = "Checking your PIN…"
        executor.execute {
            val result = cloud.startTerminalStaffSession(selected.staffId, nativePin)
            runOnUiThread {
                if (!result.installed || result.session == null) {
                    signIn.isEnabled = true
                    status.text = result.error ?: "That PIN could not be verified. Try again."
                    return@runOnUiThread
                }
                status.text = "Opening ${friendlyRole(selected.role)} workspace…"
                controller.installTerminalStaffSession(org.json.JSONObject(result.session.envelopeJson)) { installed ->
                    if (installed.installed && installed.sessionId == result.session.sessionId) {
                        Toast.makeText(this, "Welcome, ${selected.name}.", Toast.LENGTH_SHORT).show()
                        setResult(RESULT_OK)
                        finish()
                    } else {
                        cloud.clearTerminalStaffSession()
                        signIn.isEnabled = true
                        status.text = installed.error ?: "The shop device could not complete sign-in. Try again."
                    }
                }
            }
        }
    }

    private fun friendlyRole(role: String): String = when (role) {
        "CASHIER" -> "Cashier"
        "KITCHEN_STAFF" -> "Kitchen"
        "MANAGER" -> "Manager"
        "OWNER" -> "Owner"
        "ADMINISTRATOR" -> "Administrator"
        else -> role.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }
    }
}