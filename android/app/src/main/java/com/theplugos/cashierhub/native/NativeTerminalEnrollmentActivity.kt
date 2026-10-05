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
 *
 * After a successful enrollment the merchant journey continues automatically:
 * the measured local-link screen verifies the signed admission and then opens
 * the native staff PIN screen. Security checks remain unchanged; the normal
 * user simply no longer has to navigate diagnostic screens manually.
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
            hint = "Device name"
            setText("Shop terminal")
        }
        val roleValues = listOf("CASHIER", "KITCHEN_STAFF", "MANAGER")
        val role = Spinner(this).apply {
            adapter = ArrayAdapter(
                this@NativeTerminalEnrollmentActivity,
                android.R.layout.simple_spinner_dropdown_item,
                listOf("Cashier", "Kitchen", "Manager")
            )
        }
        val code = EditText(this).apply {
            hint = "6-digit invite code"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val submit = Button(this).apply {
            text = "Add this device"
            isAllCaps = false
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            addView(TextView(this@NativeTerminalEnrollmentActivity).apply {
                text = "ThePlugOS\nAdd a shop device"
                textSize = 26f
                setPadding(0, 0, 0, 28)
            })
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
            activeHub != null -> "This phone is already the main shop device. Use another device for a cashier, kitchen or manager station."
            !cloud.isConfigured() -> "Device setup is unavailable in this app build."
            existingAdmission != null -> "This device is already added as ${friendlyRole(existingAdmission.terminalRole)}. Use a new owner invite only when replacing its access."
            else -> "Enter the invite code created by the owner or manager, then choose what this device will be used for."
        }
        submit.isEnabled = activeHub == null && cloud.isConfigured()

        submit.setOnClickListener {
            val pairingCode = code.text.toString().toCharArray()
            val requestedName = terminalName.text.toString()
            val requestedRole = roleValues.getOrElse(role.selectedItemPosition) { "CASHIER" }
            code.text?.clear()
            submit.isEnabled = false
            status.text = "Adding this device…"
            executor.execute {
                val result = cloud.enrollTerminal(pairingCode, requestedName, requestedRole)
                runOnUiThread {
                    submit.isEnabled = true
                    if (result.installed) {
                        Toast.makeText(this, "Device added. Connecting to your shop…", Toast.LENGTH_SHORT).show()
                        startActivity(
                            Intent(this, NativeTerminalLocalLinkActivity::class.java)
                                .putExtra(NativeTerminalLocalLinkActivity.EXTRA_AUTO_SIGN_IN, true)
                        )
                        setResult(RESULT_OK)
                        finish()
                    } else {
                        status.text = result.error ?: "This device could not be added. Check the invite code and try again."
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun friendlyRole(role: String): String = when (role) {
        "CASHIER" -> "Cashier"
        "KITCHEN_STAFF" -> "Kitchen"
        "MANAGER" -> "Manager"
        else -> role.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }
    }

    private fun runtime(): CashierHubRuntime = (application as ThePlugOSApplication).cashierHubRuntime
}