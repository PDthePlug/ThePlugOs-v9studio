package com.theplugos.cashierhub.native

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.theplugos.cashierhub.ThePlugOSApplication
import java.util.concurrent.Executors

/**
 * Native-only recovery surface. The Capacitor bridge can open this Activity,
 * but never passes a recovery code, PIN, staff ID, proof, or completion value.
 */
class NativeStaffCredentialResetActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private var pendingChallenge: NativeStaffCredentialResetChallenge? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Recovery codes and PIN fields should not appear in Android recents or
        // be captured by normal screenshots while an operator is entering them.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        val status = TextView(this).apply {
            text = "Enter the owner-issued recovery code on this enrolled Cashier Hub."
        }
        val code = EditText(this).apply {
            hint = "12-character recovery code"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            disableAutofill(this)
        }
        val begin = Button(this).apply { text = "Verify recovery code" }
        val newPin = EditText(this).apply {
            hint = "New numeric PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            disableAutofill(this)
            visibility = View.GONE
        }
        val confirmPin = EditText(this).apply {
            hint = "Confirm new PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            disableAutofill(this)
            visibility = View.GONE
        }
        val complete = Button(this).apply {
            text = "Set native PIN"
            visibility = View.GONE
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 72, 48, 48)
            addView(status)
            addView(code)
            addView(begin)
            addView(newPin)
            addView(confirmPin)
            addView(complete)
        }
        setContentView(layout)

        begin.setOnClickListener {
            val resetCode = code.text.toString().toCharArray()
            code.text?.clear()
            begin.isEnabled = false
            status.text = "Verifying owner authorization…"
            executor.execute {
                val result = runtime().beginStaffCredentialResetFromNativeScreen(resetCode)
                runOnUiThread {
                    begin.isEnabled = true
                    val challenge = result.challenge
                    if (challenge == null) {
                        status.text = result.error ?: "The owner recovery code could not be accepted."
                        return@runOnUiThread
                    }
                    pendingChallenge = challenge
                    code.visibility = View.GONE
                    begin.visibility = View.GONE
                    newPin.visibility = View.VISIBLE
                    confirmPin.visibility = View.VISIBLE
                    complete.visibility = View.VISIBLE
                    status.text = "Set a new PIN for ${challenge.staffName} (${challenge.staffRole.replace('_', ' ')})."
                }
            }
        }

        complete.setOnClickListener {
            val challenge = pendingChallenge ?: return@setOnClickListener
            val first = newPin.text.toString().toCharArray()
            val confirmation = confirmPin.text.toString().toCharArray()
            newPin.text?.clear()
            confirmPin.text?.clear()
            if (!first.contentEquals(confirmation)) {
                first.fill('\u0000')
                confirmation.fill('\u0000')
                status.text = "The PIN entries do not match. Enter both values again."
                return@setOnClickListener
            }
            confirmation.fill('\u0000')
            complete.isEnabled = false
            status.text = "Signing and setting the native PIN…"
            executor.execute {
                val result = runtime().completeStaffCredentialResetFromNativeScreen(challenge, first)
                runOnUiThread {
                    complete.isEnabled = true
                    if (!result.completed) {
                        status.text = result.error ?: "Credential reset could not be completed."
                        return@runOnUiThread
                    }
                    val message = if (result.authorityReconciled) {
                        "Credential reset complete. All branch staff must sign in again."
                    } else {
                        result.error ?: "Credential reset complete. Reconnect this Hub and wait for authority reconciliation before staff sign-in."
                    }
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                    setResult(RESULT_OK)
                    finish()
                }
            }
        }
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun runtime(): CashierHubRuntime = (application as ThePlugOSApplication).cashierHubRuntime

    private fun disableAutofill(field: EditText) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            field.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
    }
}
