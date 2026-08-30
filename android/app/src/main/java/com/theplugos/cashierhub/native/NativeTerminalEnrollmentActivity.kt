package com.theplugos.cashierhub.native

import android.app.Activity
import android.content.Intent
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
import com.theplugos.cashierhub.ThePlugOSApplication
import java.util.concurrent.Executors

/**
 * Native-only branch terminal enrollment. A code is entered on this device,
 * never accepted from a Capacitor/browser call. The result is a signed
 * terminal admission bound to this device's Keystore key and the active Hub
 * certificate fingerprint.
 */
class NativeTerminalEnrollmentActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private lateinit var terminalKeys: TerminalKeyManager
    private lateinit var cloud: TerminalCloudAuthorityClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        terminalKeys = TerminalKeyManager(applicationContext)
        cloud = TerminalCloudAuthorityClient(terminalKeys)

        val status = TextView(this)
        val terminalName = EditText(this).apply {
            hint = "Terminal name"
            setText("Branch terminal")
        }
        val roleValues = listOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
        val role = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@NativeTerminalEnrollmentActivity,
                android.R.layout.simple_spinner_dropdown_item,
                roleValues.map { value -> value.replace('_', ' ') }
            )
        }
        val code = EditText(this).apply {
            hint = "6-digit terminal pairing code"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val submit = Button(this).apply { text = "Enroll branch terminal" }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            addView(status)
            addView(terminalName)
            addView(role)
            addView(code)
            addView(submit)
        }
        setContentView(layout)

        val activeHub = runtime().activeAuthorizationBundleForCloud()
        val existingAdmission = cloud.currentAdmission()
        status.text = when {
            activeHub != null -> "This Android installation is already enrolled as the Cashier Hub. Use a separate terminal installation so it cannot hold both roles."
            !cloud.isConfigured() -> "Terminal cloud enrollment is not configured in this Android build."
            existingAdmission != null -> "This terminal has a valid " + existingAdmission.terminalRole.replace('_', ' ') +
                " admission. Re-enrollment replaces its cloud authority and should be used only when the owner issued a new code."
            else -> "Enter the owner-issued code. The terminal will later connect only to the Hub whose TLS certificate matches its signed admission."
        }
        submit.isEnabled = activeHub == null && cloud.isConfigured()

        submit.setOnClickListener {
            val pairingCode = code.text.toString().toCharArray()
            val requestedName = terminalName.text.toString()
            val requestedRole = roleValues.getOrElse(role.selectedItemPosition) { "CASHIER" }
            code.text?.clear()
            submit.isEnabled = false
            status.text = "Verifying terminal enrollment…"
            executor.execute {
                val result = cloud.enrollTerminal(pairingCode, requestedName, requestedRole)
                runOnUiThread {
                    submit.isEnabled = true
                    if (result.installed) {
                        val admission = result.admission
                        Toast.makeText(
                            this,
                            "Terminal admitted. The Hub must reconcile its signed authority before the local link is accepted.",
                            Toast.LENGTH_LONG
                        ).show()
                        status.text = "Cloud admission installed for " + (admission?.terminalRole?.replace('_', ' ') ?: "terminal") +
                            ". Continue on the terminal's local-link screen after the active Hub has reconciled."
                        startActivity(Intent(this, NativeTerminalLocalLinkActivity::class.java))
                        setResult(RESULT_OK)
                        finish()
                    } else {
                        status.text = result.error ?: "The terminal could not be enrolled."
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun runtime(): CashierHubRuntime = (application as ThePlugOSApplication).cashierHubRuntime
}
