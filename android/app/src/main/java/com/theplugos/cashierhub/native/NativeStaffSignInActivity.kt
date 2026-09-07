package com.theplugos.cashierhub.native

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.theplugos.cashierhub.ThePlugOSApplication
import java.util.concurrent.Executors

/**
 * Merchant-facing staff gate. The fresh PIN is captured and verified entirely
 * inside this Android Activity. React may launch the screen and later receive a
 * role-minimized operator projection, but it never receives the PIN, staff
 * session bearer, verifier, signature, or device authority material.
 */
class NativeStaffSignInActivity : Activity() {
    private val executor = Executors.newSingleThreadExecutor()
    private var staff = emptyList<StaffDirectoryRecord>()
    private val staffByButtonId = mutableMapOf<Int, StaffDirectoryRecord>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#F7F2E9")
        window.navigationBarColor = Color.parseColor("#F7F2E9")
        staff = runtime().nativeStaffDirectory()

        val page = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(28), dp(22), dp(32))
            setBackgroundColor(Color.parseColor("#F7F2E9"))
        }

        val brand = TextView(this).apply {
            text = "ThePlugOS"
            setTextColor(Color.parseColor("#171714"))
            textSize = 25f
            typeface = Typeface.DEFAULT_BOLD
        }
        val eyebrow = TextView(this).apply {
            text = "STAFF ACCESS"
            setTextColor(Color.parseColor("#9A6710"))
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.16f
            setPadding(0, dp(8), 0, 0)
        }
        val title = TextView(this).apply {
            text = "Who’s working this station?"
            setTextColor(Color.parseColor("#171714"))
            textSize = 31f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(24), 0, 0)
        }
        val intro = TextView(this).apply {
            text = "Choose your profile and enter your PIN. ThePlugOS will open only the tools assigned to your role."
            setTextColor(Color.parseColor("#716A5F"))
            textSize = 14f
            setLineSpacing(0f, 1.18f)
            setPadding(0, dp(10), 0, dp(22))
        }
        val status = TextView(this).apply {
            text = if (staff.isEmpty()) {
                "No active staff profiles are available. Ask the owner or manager to refresh this enrolled device."
            } else {
                "Choose your profile."
            }
            setTextColor(if (staff.isEmpty()) Color.parseColor("#A33B3B") else Color.parseColor("#6C655A"))
            textSize = 13f
            background = roundedBackground("#FFFDF8", "#DED5C5", 18f)
            setPadding(dp(15), dp(12), dp(15), dp(12))
        }

        val profilesLabel = TextView(this).apply {
            text = "YOUR PROFILE"
            setTextColor(Color.parseColor("#716A5F"))
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.12f
            setPadding(0, dp(22), 0, dp(8))
        }

        val profiles = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
        }
        staff.forEachIndexed { index, record ->
            val buttonId = View.generateViewId()
            staffByButtonId[buttonId] = record
            val profile = RadioButton(this).apply {
                id = buttonId
                text = "${record.name}\n${friendlyRole(record.role)}"
                setTextColor(Color.parseColor("#171714"))
                textSize = 15f
                typeface = Typeface.DEFAULT_BOLD
                buttonTintList = android.content.res.ColorStateList.valueOf(Color.parseColor("#D99012"))
                background = roundedBackground("#FFFDF8", "#DED5C5", 18f)
                setPadding(dp(14), dp(13), dp(14), dp(13))
                val params = RadioGroup.LayoutParams(RadioGroup.LayoutParams.MATCH_PARENT, RadioGroup.LayoutParams.WRAP_CONTENT)
                params.bottomMargin = dp(9)
                layoutParams = params
            }
            profiles.addView(profile)
            if (index == 0) profiles.check(buttonId)
        }

        val pinLabel = TextView(this).apply {
            text = "STAFF PIN"
            setTextColor(Color.parseColor("#716A5F"))
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.12f
            setPadding(0, dp(18), 0, dp(8))
        }
        val pin = EditText(this).apply {
            hint = "Enter PIN"
            setHintTextColor(Color.parseColor("#AAA397"))
            setTextColor(Color.parseColor("#171714"))
            textSize = 22f
            gravity = Gravity.CENTER
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            filters = arrayOf(InputFilter.LengthFilter(8))
            background = roundedBackground("#FFFDF8", "#CFC4B2", 18f)
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }
        val privacy = TextView(this).apply {
            text = "Your PIN is verified securely on this enrolled device and is never shown in the owner portal."
            setTextColor(Color.parseColor("#817A6F"))
            textSize = 11f
            setPadding(0, dp(9), 0, dp(18))
        }
        val submit = Button(this).apply {
            text = "Sign in & open workspace"
            isEnabled = staff.isNotEmpty()
            setTextColor(Color.WHITE)
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            background = roundedBackground("#171714", "#171714", 18f)
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }

        page.addView(brand)
        page.addView(eyebrow)
        page.addView(title)
        page.addView(intro)
        page.addView(status)
        page.addView(profilesLabel)
        page.addView(profiles)
        page.addView(pinLabel)
        page.addView(pin)
        page.addView(privacy)
        page.addView(submit, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(page)
        }
        setContentView(scroll)

        submit.setOnClickListener {
            val selected = staffByButtonId[profiles.checkedRadioButtonId]
            if (selected == null) {
                status.text = "Choose your staff profile before continuing."
                return@setOnClickListener
            }
            val pinChars = pin.text.toString().toCharArray()
            pin.text?.clear()
            if (pinChars.isEmpty()) {
                status.text = "Enter your staff PIN before continuing."
                return@setOnClickListener
            }

            submit.isEnabled = false
            profiles.isEnabled = false
            status.text = "Checking your PIN…"
            executor.execute {
                val result = runtime().beginStaffSessionFromNativeScreen(selected.staffId, pinChars)
                runOnUiThread {
                    submit.isEnabled = true
                    profiles.isEnabled = true
                    if (result.installed) {
                        Toast.makeText(this, "Welcome, ${selected.name}.", Toast.LENGTH_SHORT).show()
                        setResult(RESULT_OK)
                        finish()
                    } else {
                        status.text = result.error ?: "That PIN could not be verified. Try again."
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
        "OWNER" -> "Owner"
        "ADMINISTRATOR" -> "Administrator"
        else -> role.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }
    }

    private fun roundedBackground(fill: String, stroke: String, radiusDp: Float): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radiusDp.toInt()).toFloat()
            setColor(Color.parseColor(fill))
            setStroke(dp(1), Color.parseColor(stroke))
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun runtime(): CashierHubRuntime = (application as ThePlugOSApplication).cashierHubRuntime
}