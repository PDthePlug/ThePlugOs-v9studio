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
import com.theplugos.cashierhub.ThePlugOSApplication
import java.util.concurrent.Executors

/**
 * Captures the fresh staff PIN inside a native Android window. The React layer
 * can launch this activity but cannot read, prefill, or receive the PIN.
 */
class NativeStaffSignInActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private var staff = emptyList<StaffDirectoryRecord>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        staff = runtime().nativeStaffDirectory()
        val status = TextView(this).apply {
            text = if (staff.isEmpty()) {
                "No active staff directory is available. Renew the enrolled Hub online before signing in."
            } else {
                "Select your name and enter your PIN."
            }
        }
        val spinner = Spinner(this)
        spinner.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            staff.map { "${it.name} (${it.role.replace('_', ' ')})" }
        )
        val pin = EditText(this).apply {
            hint = "PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val submit = Button(this).apply {
            text = "Sign in"
            isEnabled = staff.isNotEmpty()
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            addView(status)
            addView(spinner)
            addView(pin)
            addView(submit)
        }
        setContentView(layout)

        submit.setOnClickListener {
            val selected = staff.getOrNull(spinner.selectedItemPosition) ?: return@setOnClickListener
            val pinChars = pin.text.toString().toCharArray()
            pin.text?.clear()
            submit.isEnabled = false
            status.text = "Verifying native sign-in…"
            executor.execute {
                val result = runtime().beginStaffSessionFromNativeScreen(selected.staffId, pinChars)
                runOnUiThread {
                    submit.isEnabled = true
                    if (result.installed) {
                        Toast.makeText(
                            this,
                            if (result.warning == null) "Signed in." else "Signed in; paired-device transport needs attention.",
                            Toast.LENGTH_LONG
                        ).show()
                        setResult(RESULT_OK)
                        finish()
                    } else {
                        status.text = result.error ?: "Sign-in could not be completed."
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
