package com.theplugos.cashierhub.native

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.theplugos.cashierhub.ThePlugOSApplication
import java.util.concurrent.Executors

/** Native-only one-time Cashier Hub enrollment. No pairing code enters JS. */
class NativeHubEnrollmentActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val status = TextView(this).apply { text = "Connect this Cashier Hub using a one-time branch code." }
        val hubName = EditText(this).apply {
            hint = "Hub name"
            setText("Cashier Hub")
        }
        val code = EditText(this).apply {
            hint = "6-digit enrollment code"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val submit = Button(this).apply { text = "Enroll Cashier Hub" }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            addView(status)
            addView(hubName)
            addView(code)
            addView(submit)
        }
        setContentView(layout)

        submit.setOnClickListener {
            val pairingCode = code.text.toString().toCharArray()
            val requestedHubName = hubName.text.toString()
            code.text?.clear()
            submit.isEnabled = false
            status.text = "Verifying enrollment…"
            executor.execute {
                val result = runtime().enrollFromNativeScreen(pairingCode, requestedHubName)
                runOnUiThread {
                    submit.isEnabled = true
                    if (result.installed) {
                        Toast.makeText(
                            this,
                            if (result.warning == null) "Cashier Hub enrolled." else "Cashier Hub enrolled; paired-device transport needs attention.",
                            Toast.LENGTH_LONG
                        ).show()
                        setResult(RESULT_OK)
                        finish()
                    } else {
                        status.text = result.error ?: "Enrollment could not be completed."
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
