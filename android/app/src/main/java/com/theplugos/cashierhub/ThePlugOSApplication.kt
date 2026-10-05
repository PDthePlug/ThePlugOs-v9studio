package com.theplugos.cashierhub

import android.app.Application
import com.theplugos.cashierhub.native.CashierHubRuntime

class ThePlugOSApplication : Application() {
    lateinit var cashierHubRuntime: CashierHubRuntime
        private set

    override fun onCreate() {
        super.onCreate()
        cashierHubRuntime = CashierHubRuntime(this)
    }
}
