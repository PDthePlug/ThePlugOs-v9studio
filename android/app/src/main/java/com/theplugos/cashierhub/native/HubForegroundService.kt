package com.theplugos.cashierhub.native

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.theplugos.cashierhub.R
import com.theplugos.cashierhub.ThePlugOSApplication

class HubForegroundService : Service() {
    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIFICATION_ID, notification())
        runtime().startForegroundService()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        runtime().stopForegroundService()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun runtime(): CashierHubRuntime = (application as ThePlugOSApplication).cashierHubRuntime

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.hub_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply { description = getString(R.string.hub_channel_description) }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notification(): Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(getString(R.string.app_name))
        .setContentText("Checking local Hub authority")
        .setSmallIcon(android.R.drawable.stat_sys_upload)
        .setOngoing(true)
        .build()

    companion object {
        const val CHANNEL_ID = "cashier_hub_operation"
        const val NOTIFICATION_ID = 41052

        fun intent(context: Context) = Intent(context, HubForegroundService::class.java)
    }
}
