package com.theplugos.cashierhub.native

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.NetworkInfo
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pManager
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceRequest
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetAddress
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.UUID
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

enum class TerminalLocalLinkState {
    NOT_ENROLLED,
    DISCOVERING,
    PROXIMITY_SEEN,
    ENDPOINT_RESOLVED,
    TLS_PINNING,
    CHALLENGED,
    AUTHENTICATED,
    STAFF_SESSION_ACTIVE,
    UNAVAILABLE,
}

data class TerminalLocalLinkSnapshot(
    val state: TerminalLocalLinkState,
    val detail: String,
    val transport: String? = null,
    val serviceName: String? = null,
)

data class TerminalLocalStaffSessionResult(
    val installed: Boolean,
    val sessionId: String? = null,
    val expiresAt: String? = null,
    val error: String? = null,
)

/**
 * Native terminal local-link engine. mDNS, Wi-Fi Direct, and BLE may discover
 * a possible Hub, but only the signed admission, a certificate pin, and the
 * Hub's fresh signed-device challenge establish an authenticated connection.
 *
 * Native-only session and command messages are available only after that proof
 * succeeds. This controller has no Capacitor/browser API and never creates a
 * staff session, command sequence, or signature on behalf of a caller.
 */
class TerminalLocalLinkController(
    context: Context,
    private val keys: TerminalKeyManager = TerminalKeyManager(context.applicationContext),
    private val admissions: TerminalAdmissionCoordinator = TerminalAdmissionCoordinator(keys),
    private val onSnapshot: (TerminalLocalLinkSnapshot) -> Unit,
    private val onCommittedEvent: () -> Unit = {},
) {
    private val appContext = context.applicationContext
    private val mainHandler = Handler(Looper.getMainLooper())
    private val nsd = appContext.getSystemService(NsdManager::class.java)
    private val wifiP2p = appContext.getSystemService(WifiP2pManager::class.java)

    @Volatile
    private var snapshot = TerminalLocalLinkSnapshot(
        TerminalLocalLinkState.NOT_ENROLLED,
        "No verified terminal admission is installed.",
    )

    @Volatile
    private var activeAdmission: TerminalAdmission? = null

    @Volatile
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    @Volatile
    private var activeScan: ScanCallback? = null

    @Volatile
    private var socket: WebSocketClient? = null

    @Volatile
    private var stopping = false

    @Volatile
    private var resolving = false

    @Volatile
    private var proximitySeen = false

    @Volatile
    private var wifiP2pChannel: WifiP2pManager.Channel? = null

    @Volatile
    private var wifiP2pRequest: WifiP2pDnsSdServiceRequest? = null

    @Volatile
    private var wifiDirectCandidate: WifiDirectCandidate? = null

    @Volatile
    private var wifiP2pReceiverRegistered = false

    @Volatile
    private var pendingDirectoryCallback: ((List<StaffDirectoryRecord>?, String?) -> Unit)? = null

    @Volatile
    private var pendingSessionCallback: ((TerminalLocalStaffSessionResult) -> Unit)? = null

    @Volatile
    private var pendingOperatorContextCallback: ((NativeOperatorContext?, String?) -> Unit)? = null

    @Volatile
    private var pendingCommandCallback: ((TerminalOperationalCommandResult) -> Unit)? = null

    private val wifiP2pReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION || stopping) return
            @Suppress("DEPRECATION")
            val network = intent.getParcelableExtra<NetworkInfo>(WifiP2pManager.EXTRA_NETWORK_INFO)
            if (network?.isConnected != true) return
            val manager = wifiP2p ?: return
            val channel = wifiP2pChannel ?: return
            val candidate = wifiDirectCandidate ?: return
            runCatching {
                manager.requestConnectionInfo(channel) { info ->
                    val groupOwner = info.groupOwnerAddress
                    if (!stopping && info.groupFormed && !info.isGroupOwner && groupOwner != null) {
                        publish(
                            TerminalLocalLinkState.ENDPOINT_RESOLVED,
                            "A signed-admission-matching Hub was resolved over Wi-Fi Direct.",
                            transport = "WIFI_DIRECT",
                            serviceName = candidate.serviceName,
                        )
                        activeAdmission?.let { admission ->
                            connectPinned(admission, groupOwner, candidate.port, "WIFI_DIRECT", candidate.serviceName)
                        }
                    }
                }
            }
        }
    }

    @Synchronized
    fun start() {
        stopInternal(publishStopped = false)
        val admission = admissions.currentAdmission()
        if (admission == null) {
            publish(TerminalLocalLinkState.NOT_ENROLLED, "Install a valid cloud-signed terminal admission before local discovery.")
            return
        }
        stopping = false
        activeAdmission = admission
        proximitySeen = false
        publish(TerminalLocalLinkState.DISCOVERING, "Searching for the admitted Cashier Hub over local Wi-Fi.")
        startBluetoothProximity(admission)
        startLanDiscovery(admission)
        startWifiDirectDiscovery(admission)
    }

    @Synchronized
    fun stop() {
        stopInternal(publishStopped = true)
    }

    fun current(): TerminalLocalLinkSnapshot = snapshot

    /** Requests only the role-filtered non-secret roster from an already
     * authenticated Hub. A roster response is never a staff session. */
    @Synchronized
    fun requestTerminalStaffDirectory(onResult: (List<StaffDirectoryRecord>?, String?) -> Unit) {
        val client = authenticatedClient() ?: run {
            mainHandler.post { onResult(null, "Authenticate the admitted Hub before requesting the native staff directory.") }
            return
        }
        if (pendingDirectoryCallback != null) {
            mainHandler.post { onResult(null, "A terminal staff-directory request is already in progress.") }
            return
        }
        pendingDirectoryCallback = onResult
        runCatching { client.send(JSONObject().put("type", "STAFF_DIRECTORY_REQUEST").toString()) }
            .onFailure { failPendingLocalRequest("The Hub staff directory could not be requested.") }
    }

    /** Forwards a verified compact cloud assertion to the exact Hub that
     * authenticated this terminal. It does not accept a browser session or
     * construct any authority material itself. */
    @Synchronized
    fun installTerminalStaffSession(
        envelope: JSONObject,
        onResult: (TerminalLocalStaffSessionResult) -> Unit,
    ) {
        val client = authenticatedClient() ?: run {
            mainHandler.post {
                onResult(TerminalLocalStaffSessionResult(false, error = "Authenticate the admitted Hub before installing a terminal staff session."))
            }
            return
        }
        if (envelope.toString().length > MAX_SESSION_ENVELOPE_CHARS) {
            mainHandler.post { onResult(TerminalLocalStaffSessionResult(false, error = "The terminal staff-session assertion is too large.")) }
            return
        }
        if (pendingSessionCallback != null) {
            mainHandler.post { onResult(TerminalLocalStaffSessionResult(false, error = "A terminal staff-session installation is already in progress.")) }
            return
        }
        pendingSessionCallback = onResult
        runCatching {
            client.send(JSONObject().put("type", "STAFF_SESSION").put("envelope", envelope).toString())
        }.onFailure { failPendingLocalRequest("The Hub staff session could not be installed.") }
    }

    /** Retrieves a fresh Hub-built role projection only from the terminal's
     * authenticated TLS connection. The session ID is not authority by itself:
     * the Hub binds it to the admitted terminal device, active revision, role,
     * branch, and expiry before returning any task data. */
    @Synchronized
    fun requestTerminalOperatorContext(
        staffSessionId: String,
        onResult: (NativeOperatorContext?, String?) -> Unit,
    ) {
        val client = authenticatedClient() ?: run {
            mainHandler.post { onResult(null, "Authenticate the admitted Hub before requesting terminal task data.") }
            return
        }
        val sessionId = try {
            UUID.fromString(staffSessionId.trim()).toString()
        } catch (_: IllegalArgumentException) {
            mainHandler.post { onResult(null, "The native terminal staff session is invalid.") }
            return
        }
        if (pendingOperatorContextCallback != null) {
            mainHandler.post { onResult(null, "A terminal task-data request is already in progress.") }
            return
        }
        pendingOperatorContextCallback = onResult
        runCatching {
            client.send(JSONObject().put("type", "OPERATOR_CONTEXT_REQUEST").put("staffSessionId", sessionId).toString())
        }.onFailure { failPendingLocalRequest("The Hub terminal task data could not be requested.") }
    }

    /** The native terminal command client persists and signs an exact command
     * before it reaches this transport. This method merely delivers that
     * already-signed envelope over an authenticated pinned TLS socket. */
    @Synchronized
    fun submitOperationalCommand(
        command: JSONObject,
        onResult: (TerminalOperationalCommandResult) -> Unit,
    ) {
        val client = authenticatedClient() ?: run {
            mainHandler.post { onResult(TerminalOperationalCommandResult("", "UNAVAILABLE", error = "Authenticate the admitted Hub before submitting a command.")) }
            return
        }
        val admission = activeAdmission ?: run {
            mainHandler.post { onResult(TerminalOperationalCommandResult("", "UNAVAILABLE", error = "A current terminal admission is required.")) }
            return
        }
        val parsed = try {
            OperationalCommand.fromJson(command)
        } catch (error: IllegalStateException) {
            mainHandler.post { onResult(TerminalOperationalCommandResult("", "REJECTED", error = error.message ?: "The terminal command is invalid.")) }
            return
        }
        if (parsed.deviceId != admission.terminalDeviceId) {
            mainHandler.post { onResult(TerminalOperationalCommandResult(parsed.commandId, "REJECTED", error = "The command is not bound to this terminal.")) }
            return
        }
        if (pendingCommandCallback != null) {
            mainHandler.post { onResult(TerminalOperationalCommandResult(parsed.commandId, "UNAVAILABLE", error = "A terminal command is already awaiting a Hub result.")) }
            return
        }
        pendingCommandCallback = onResult
        runCatching { client.send(JSONObject().put("type", "COMMAND").put("command", command).toString()) }
            .onFailure { failPendingLocalRequest("The signed terminal command could not be sent to the Hub.") }
    }

    private fun stopInternal(publishStopped: Boolean) {
        stopping = true
        failPendingLocalRequest("The terminal local link was stopped before the request completed.")
        activeAdmission = null
        resolving = false
        socket?.let { client ->
            socket = null
            runCatching { client.close() }
        }
        stopBluetoothProximity()
        stopWifiDirectDiscovery()
        val listener = discoveryListener
        discoveryListener = null
        if (listener != null) {
            runCatching { nsd?.stopServiceDiscovery(listener) }
        }
        if (publishStopped) {
            publish(TerminalLocalLinkState.UNAVAILABLE, "Local-link discovery was stopped.")
        }
    }

    private fun authenticatedClient(): WebSocketClient? {
        val client = socket ?: return null
        if (!client.isOpen || snapshot.state !in setOf(
                TerminalLocalLinkState.AUTHENTICATED,
                TerminalLocalLinkState.STAFF_SESSION_ACTIVE
            )
        ) return null
        return client
    }

    private fun deliverDirectory(staff: List<StaffDirectoryRecord>?, error: String?) {
        val callback = pendingDirectoryCallback
        pendingDirectoryCallback = null
        if (callback != null) mainHandler.post { callback(staff, error) }
    }

    private fun deliverSession(result: TerminalLocalStaffSessionResult) {
        val callback = pendingSessionCallback
        pendingSessionCallback = null
        if (callback != null) mainHandler.post { callback(result) }
    }

    private fun deliverOperatorContext(context: NativeOperatorContext?, error: String?) {
        val callback = pendingOperatorContextCallback
        pendingOperatorContextCallback = null
        if (callback != null) mainHandler.post { callback(context, error) }
    }

    private fun deliverCommand(result: TerminalOperationalCommandResult) {
        val callback = pendingCommandCallback
        pendingCommandCallback = null
        if (callback != null) mainHandler.post { callback(result) }
    }

    private fun failPendingLocalRequest(detail: String) {
        deliverDirectory(null, detail)
        deliverSession(TerminalLocalStaffSessionResult(false, error = detail))
        deliverOperatorContext(null, detail)
        deliverCommand(TerminalOperationalCommandResult("", "UNAVAILABLE", error = detail))
    }

    private fun startLanDiscovery(admission: TerminalAdmission) {
        val manager = nsd
        if (manager == null) {
            publish(TerminalLocalLinkState.UNAVAILABLE, "Android local service discovery is unavailable.")
            return
        }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                discoveryListener = null
                publish(TerminalLocalLinkState.UNAVAILABLE, "LAN service discovery could not start (code $errorCode).")
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                discoveryListener = null
                if (!stopping) publish(TerminalLocalLinkState.UNAVAILABLE, "LAN service discovery stopped unexpectedly (code $errorCode).")
            }

            override fun onDiscoveryStarted(serviceType: String) = Unit

            override fun onDiscoveryStopped(serviceType: String) {
                discoveryListener = null
                if (!stopping && snapshot.state != TerminalLocalLinkState.AUTHENTICATED) {
                    publish(TerminalLocalLinkState.UNAVAILABLE, "LAN service discovery stopped before an authenticated Hub connection was established.")
                }
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (stopping || serviceInfo.serviceType != MDNS_SERVICE_TYPE || resolving) return
                resolving = true
                try {
                    manager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                            resolving = false
                        }

                        override fun onServiceResolved(info: NsdServiceInfo) {
                            resolving = false
                            resolveLanService(admission, info)
                        }
                    })
                } catch (_: Exception) {
                    resolving = false
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
        }
        discoveryListener = listener
        try {
            manager.discoverServices(MDNS_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
            discoveryListener = null
            publish(TerminalLocalLinkState.UNAVAILABLE, "LAN service discovery is unavailable on this Android network.")
        }
    }

    private fun resolveLanService(admission: TerminalAdmission, service: NsdServiceInfo) {
        if (stopping || !matchesAdmission(admission, service)) return
        val host = service.host ?: return
        val port = service.port
        if (port !in 1..65535) return
        publish(
            TerminalLocalLinkState.ENDPOINT_RESOLVED,
            "A signed-admission-matching Hub was resolved over LAN Wi-Fi.",
            transport = "LAN_WIFI",
            serviceName = service.serviceName,
        )
        connectPinned(admission, host, port, "LAN_WIFI", service.serviceName)
    }

    private fun matchesAdmission(admission: TerminalAdmission, service: NsdServiceInfo): Boolean {
        if (service.serviceType != MDNS_SERVICE_TYPE) return false
        val attributes = service.attributes
        val version = attributes["v"]?.toString(StandardCharsets.UTF_8)
        val hub = attributes["hub"]?.toString(StandardCharsets.UTF_8)
        val fingerprint = attributes["fp"]?.toString(StandardCharsets.UTF_8)?.lowercase()
        val advertisedPort = attributes["port"]?.toString(StandardCharsets.UTF_8)?.toIntOrNull()
        return version == "1" && hub == admission.hubDeviceId &&
            fingerprint == admission.hubTlsCertificateSha256 && advertisedPort == service.port
    }

    /** Discovers the same signed Hub record over Android Wi-Fi Direct DNS-SD.
     * The Hub creates the group; this terminal accepts only the client path to
     * the group owner and then uses the normal pinned TLS WebSocket flow. */
    private fun startWifiDirectDiscovery(admission: TerminalAdmission) {
        if (!hasWifiDirectPermission()) return
        val manager = wifiP2p ?: return
        val channel = try {
            manager.initialize(appContext, appContext.mainLooper) {
                if (!stopping) publish(TerminalLocalLinkState.DISCOVERING, "Wi-Fi Direct channel changed; continuing LAN discovery.")
            }
        } catch (_: Exception) {
            null
        } ?: return
        wifiP2pChannel = channel
        val filter = IntentFilter(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
        try {
            ContextCompat.registerReceiver(appContext, wifiP2pReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            wifiP2pReceiverRegistered = true
        } catch (_: Exception) {
            wifiP2pChannel = null
            return
        }
        val serviceListener = WifiP2pManager.DnsSdServiceResponseListener { _, _, _ ->
            // The accompanying TXT record carries the signed-admission match
            // fields; a bare service response has no authority value.
        }
        val txtRecordListener = WifiP2pManager.DnsSdTxtRecordListener { fullDomainName, record, device ->
            val hub = record["hub"]
            val fingerprint = record["fp"]?.lowercase()
            val version = record["v"]
            val port = record["port"]?.toIntOrNull()
            val matches = !stopping && fullDomainName.contains(WIFI_DIRECT_SERVICE_TYPE) &&
                version == "1" && hub == admission.hubDeviceId &&
                fingerprint == admission.hubTlsCertificateSha256 && port != null && port in 1..65535
            if (matches) {
                val candidate = WifiDirectCandidate(port, "Wi-Fi Direct ${device.deviceAddress}")
                wifiDirectCandidate = candidate
                val config = WifiP2pConfig().apply { deviceAddress = device.deviceAddress }
                try {
                    manager.connect(channel, config, object : WifiP2pManager.ActionListener {
                        override fun onSuccess() = Unit
                        override fun onFailure(reason: Int) {
                            if (!stopping) publish(TerminalLocalLinkState.DISCOVERING, "Wi-Fi Direct connection was not established; continuing discovery.")
                        }
                    })
                } catch (_: Exception) {
                    if (!stopping) publish(TerminalLocalLinkState.DISCOVERING, "Wi-Fi Direct connection is unavailable; continuing discovery.")
                }
            }
        }
        try {
            manager.setDnsSdResponseListeners(channel, serviceListener, txtRecordListener)
            val request = WifiP2pDnsSdServiceRequest.newInstance()
            wifiP2pRequest = request
            manager.addServiceRequest(channel, request, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
                    try {
                        manager.discoverServices(channel, object : WifiP2pManager.ActionListener {
                            override fun onSuccess() = Unit
                            override fun onFailure(reason: Int) = Unit
                        })
                    } catch (_: Exception) {
                        // LAN discovery remains available when Wi-Fi Direct is not.
                    }
                }

                override fun onFailure(reason: Int) = Unit
            })
        } catch (_: Exception) {
            stopWifiDirectDiscovery()
        }
    }

    private fun stopWifiDirectDiscovery() {
        val manager = wifiP2p
        val channel = wifiP2pChannel
        val request = wifiP2pRequest
        wifiP2pRequest = null
        wifiP2pChannel = null
        wifiDirectCandidate = null
        if (manager != null && channel != null) {
            if (request != null) {
                runCatching {
                    manager.removeServiceRequest(channel, request, object : WifiP2pManager.ActionListener {
                        override fun onSuccess() = Unit
                        override fun onFailure(reason: Int) = Unit
                    })
                }
            }
            runCatching {
                manager.cancelConnect(channel, object : WifiP2pManager.ActionListener {
                    override fun onSuccess() = Unit
                    override fun onFailure(reason: Int) = Unit
                })
            }
        }
        if (wifiP2pReceiverRegistered) {
            wifiP2pReceiverRegistered = false
            runCatching { appContext.unregisterReceiver(wifiP2pReceiver) }
        }
    }

    private fun hasWifiDirectPermission(): Boolean = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
            appContext.checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ->
            appContext.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        else -> true
    }

    private fun startBluetoothProximity(admission: TerminalAdmission) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            appContext.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED
        ) return
        val adapter = BluetoothAdapter.getDefaultAdapter()
        val scanner = runCatching { adapter?.bluetoothLeScanner }.getOrNull() ?: return
        val expectedHint = proximityHint(admission)
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val serviceData = result.scanRecord?.getServiceData(HubBluetoothProximityAdvertiser.SERVICE_UUID) ?: return
                if (serviceData.size != PROXIMITY_RECORD_BYTES || serviceData[0] != HubBluetoothProximityAdvertiser.PROTOCOL_VERSION) return
                if (!MessageDigest.isEqual(expectedHint, serviceData.copyOfRange(1, serviceData.size))) return
                if (!proximitySeen) {
                    proximitySeen = true
                    if (snapshot.state == TerminalLocalLinkState.DISCOVERING) {
                        publish(TerminalLocalLinkState.PROXIMITY_SEEN, "The admitted Hub's Bluetooth proximity beacon was measured. Continuing secure local discovery.")
                    }
                }
            }

            override fun onScanFailed(errorCode: Int) {
                // BLE is optional by design. A scan failure must not stop a
                // valid LAN/Wi-Fi Direct attempt or claim that proximity was seen.
            }
        }
        activeScan = callback
        try {
            scanner.startScan(
                listOf(ScanFilter.Builder().setServiceUuid(HubBluetoothProximityAdvertiser.SERVICE_UUID).build()),
                ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
                callback,
            )
        } catch (_: Exception) {
            activeScan = null
        }
    }

    private fun stopBluetoothProximity() {
        val callback = activeScan ?: return
        activeScan = null
        runCatching { BluetoothAdapter.getDefaultAdapter()?.bluetoothLeScanner?.stopScan(callback) }
    }

    private fun proximityHint(admission: TerminalAdmission): ByteArray = MessageDigest.getInstance("SHA-256")
        .digest((admission.hubDeviceId + ":" + admission.hubTlsCertificateSha256).toByteArray(StandardCharsets.UTF_8))
        .copyOfRange(0, HubBluetoothProximityAdvertiser.PROXIMITY_HINT_BYTES)

    private fun connectPinned(
        admission: TerminalAdmission,
        host: InetAddress,
        port: Int,
        transport: String,
        serviceName: String?,
    ) {
        if (stopping || activeAdmission?.admissionId != admission.admissionId) return
        socket?.let { existing ->
            if (existing.isOpen || existing.isConnecting) return
            runCatching { existing.close() }
        }
        val uri = try {
            URI("wss", null, host.hostAddress, port, "/", null, null)
        } catch (_: Exception) {
            return
        }
        val sslContext = try {
            SSLContext.getInstance("TLS").apply {
                init(null, arrayOf<TrustManager>(FingerprintTrustManager(admission.hubTlsCertificateSha256)), SecureRandom())
            }
        } catch (_: Exception) {
            publish(TerminalLocalLinkState.UNAVAILABLE, "The terminal TLS pinning engine is unavailable.")
            return
        }
        publish(TerminalLocalLinkState.TLS_PINNING, "Pinning the resolved Hub TLS certificate.", transport, serviceName)
        val client = object : WebSocketClient(uri) {
            override fun onOpen(handshakedata: ServerHandshake) {
                if (!stopping) publish(TerminalLocalLinkState.CHALLENGED, "Pinned TLS connected; waiting for the Hub challenge.", transport, serviceName)
            }

            override fun onMessage(message: String) {
                handleServerMessage(this, admission, message, transport, serviceName)
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                if (!stopping) failPendingLocalRequest("The authenticated Hub link closed before the request completed.")
                if (!stopping && snapshot.state !in setOf(TerminalLocalLinkState.AUTHENTICATED, TerminalLocalLinkState.STAFF_SESSION_ACTIVE)) {
                    publish(TerminalLocalLinkState.DISCOVERING, "The local Hub link closed before authentication; continuing discovery.", transport, serviceName)
                } else if (!stopping) {
                    publish(TerminalLocalLinkState.DISCOVERING, "The authenticated local Hub link closed; continuing discovery.", transport, serviceName)
                }
            }

            override fun onError(exception: Exception) {
                if (!stopping) {
                    failPendingLocalRequest("The authenticated Hub link became unavailable before the request completed.")
                    publish(TerminalLocalLinkState.DISCOVERING, "The resolved local link could not be authenticated; continuing discovery.", transport, serviceName)
                }
            }
        }
        client.setSocketFactory(sslContext.socketFactory)
        socket = client
        try {
            client.connect()
        } catch (_: Exception) {
            socket = null
            publish(TerminalLocalLinkState.DISCOVERING, "The resolved Hub connection could not start; continuing discovery.", transport, serviceName)
        }
    }

    private fun handleServerMessage(
        client: WebSocketClient,
        admission: TerminalAdmission,
        rawMessage: String,
        transport: String,
        serviceName: String?,
    ) {
        if (stopping || socket !== client || activeAdmission?.admissionId != admission.admissionId) {
            runCatching { client.close() }
            return
        }
        val message = try {
            JSONObject(rawMessage)
        } catch (_: Exception) {
            failLocalChallenge(client, transport, serviceName)
            return
        }
        when (message.optString("type", "")) {
            "CHALLENGE" -> {
                val nonce = try {
                    HubWireEncoding.decode(message.optString("nonce", ""), "Hub local challenge")
                } catch (_: Exception) {
                    failLocalChallenge(client, transport, serviceName)
                    return
                }
                val expiresAt = message.optLong("expiresAtEpochMs", 0)
                val now = System.currentTimeMillis()
                if (nonce.size != CHALLENGE_BYTES || expiresAt !in (now + 1)..(now + MAX_CHALLENGE_FUTURE_MS)) {
                    failLocalChallenge(client, transport, serviceName)
                    return
                }
                val hello = JSONObject()
                    .put("type", "HELLO")
                    .put("deviceId", admission.terminalDeviceId)
                    .put("signature", keys.sign(nonce))
                runCatching { client.send(hello.toString()) }
                    .onFailure { failLocalChallenge(client, transport, serviceName) }
            }

            "READY" -> {
                if (message.optString("deviceId", "") != admission.terminalDeviceId) {
                    failLocalChallenge(client, transport, serviceName)
                    return
                }
                publish(TerminalLocalLinkState.AUTHENTICATED, "The terminal identity was authenticated by the admitted Hub.", transport, serviceName)
            }

            "STAFF_DIRECTORY" -> {
                val staff = try {
                    parseTerminalStaffDirectory(message.optJSONArray("staff"), admission.terminalRole)
                } catch (_: Exception) {
                    failPendingLocalRequest("The Hub returned an invalid terminal staff directory.")
                    return
                }
                deliverDirectory(staff, null)
            }

            "STAFF_SESSION_RESULT" -> {
                val sessionId = try {
                    UUID.fromString(message.optString("sessionId", "").trim()).toString()
                } catch (_: Exception) {
                    failPendingLocalRequest("The Hub returned an invalid terminal staff-session result.")
                    return
                }
                val role = message.optString("role", "").trim()
                val expiresAt = message.optString("expiresAt", "").trim()
                try {
                    HubTime.requireCanonicalUtc(expiresAt, "Terminal staff-session expiry")
                    if (role != admission.terminalRole || HubTime.isExpired(expiresAt, HubCloudTime.now())) {
                        throw HubCommandRejectedException("Terminal staff session does not match the admitted role.")
                    }
                } catch (_: Exception) {
                    failPendingLocalRequest("The Hub returned an invalid terminal staff-session result.")
                    return
                }
                publish(TerminalLocalLinkState.STAFF_SESSION_ACTIVE, "A verified ${role.replace('_', ' ')} terminal staff session is active.", transport, serviceName)
                deliverSession(TerminalLocalStaffSessionResult(true, sessionId = sessionId, expiresAt = expiresAt))
            }

            "OPERATOR_CONTEXT" -> {
                val context = try {
                    val expectedRole = admission.terminalRole
                    val rawContext = message.optJSONObject("context")
                        ?: throw HubCommandRejectedException("The Hub returned no terminal task context.")
                    TerminalOperatorContextWire.decode(rawContext, expectedRole)
                } catch (_: Exception) {
                    failPendingLocalRequest("The Hub returned an invalid terminal task context.")
                    return
                }
                publish(
                    TerminalLocalLinkState.STAFF_SESSION_ACTIVE,
                    "A verified ${context.role.replace('_', ' ')} terminal task context is active.",
                    transport,
                    serviceName,
                )
                deliverOperatorContext(context, null)
            }

            "COMMAND_RESULT" -> {
                val commandId = message.optString("commandId", "").trim()
                val outcome = message.optString("outcome", "").trim()
                val committedAt = message.optString("committedAt", "").trim().ifEmpty { null }
                if (commandId.isEmpty() || outcome !in setOf("APPLIED", "DUPLICATE", "REJECTED") ||
                    (committedAt != null && runCatching { HubTime.requireCanonicalUtc(committedAt, "Terminal command commit time") }.isFailure)
                ) {
                    failPendingLocalRequest("The Hub returned an invalid terminal command result.")
                    return
                }
                deliverCommand(TerminalOperationalCommandResult(commandId, outcome, committedAt = committedAt))
            }

            "EVENT_COMMITTED" -> {
                // A broadcast only says that the Hub ledger changed. It is not
                // a replacement context, and it contains no authority for the
                // terminal. Consumers request a fresh role-minimized context.
                mainHandler.post { onCommittedEvent() }
            }

            "ERROR" -> {
                if (pendingCommandCallback != null) {
                    deliverCommand(TerminalOperationalCommandResult("", "REJECTED", error = "The Hub rejected the terminal command."))
                } else if (pendingSessionCallback != null || pendingDirectoryCallback != null || pendingOperatorContextCallback != null) {
                    failPendingLocalRequest("The Hub rejected the native terminal request.")
                } else if (snapshot.state !in setOf(TerminalLocalLinkState.AUTHENTICATED, TerminalLocalLinkState.STAFF_SESSION_ACTIVE)) {
                    failLocalChallenge(client, transport, serviceName)
                }
            }
            else -> failLocalChallenge(client, transport, serviceName)
        }
    }

    private fun parseTerminalStaffDirectory(values: JSONArray?, expectedRole: String): List<StaffDirectoryRecord> {
        if (values == null || values.length() > MAX_STAFF_DIRECTORY) {
            throw HubCommandRejectedException("The terminal staff directory is invalid.")
        }
        val seen = mutableSetOf<String>()
        return buildList {
            for (index in 0 until values.length()) {
                val value = values.optJSONObject(index)
                    ?: throw HubCommandRejectedException("The terminal staff directory is invalid.")
                val staffId = try {
                    UUID.fromString(value.optString("staffId", "").trim()).toString()
                } catch (_: Exception) {
                    throw HubCommandRejectedException("The terminal staff directory is invalid.")
                }
                val name = value.optString("name", "").trim()
                val role = value.optString("role", "").trim()
                if (!seen.add(staffId) || name.isEmpty() || name.length > 160 || role != expectedRole) {
                    throw HubCommandRejectedException("The terminal staff directory is invalid.")
                }
                add(StaffDirectoryRecord(staffId, name, role))
            }
        }
    }

    private fun failLocalChallenge(client: WebSocketClient, transport: String, serviceName: String?) {
        publish(TerminalLocalLinkState.DISCOVERING, "The Hub challenge could not be verified; continuing discovery.", transport, serviceName)
        runCatching { client.close() }
    }

    private fun publish(
        state: TerminalLocalLinkState,
        detail: String,
        transport: String? = null,
        serviceName: String? = null,
    ) {
        val next = TerminalLocalLinkSnapshot(state, detail, transport, serviceName)
        snapshot = next
        mainHandler.post { onSnapshot(next) }
    }

    private class FingerprintTrustManager(expectedFingerprint: String) : X509TrustManager {
        private val expected = expectedFingerprint.lowercase().toByteArray(StandardCharsets.US_ASCII)

        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
            throw CertificateException("Client certificates are not accepted by the terminal link.")
        }

        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
            val certificate = chain.firstOrNull() ?: throw CertificateException("Hub TLS certificate is missing.")
            certificate.checkValidity()
            val actual = MessageDigest.getInstance("SHA-256")
                .digest(certificate.encoded)
                .joinToString("") { byte -> "%02x".format(byte) }
                .toByteArray(StandardCharsets.US_ASCII)
            if (!MessageDigest.isEqual(expected, actual)) {
                throw CertificateException("Hub TLS certificate pin does not match the signed terminal admission.")
            }
        }

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    private data class WifiDirectCandidate(val port: Int, val serviceName: String)

    private companion object {
        const val MDNS_SERVICE_TYPE = "_theplugos-hub._tcp."
        const val WIFI_DIRECT_SERVICE_TYPE = "_theplugos-hub._tcp"
        const val CHALLENGE_BYTES = 32
        const val MAX_CHALLENGE_FUTURE_MS = 60_000L
        const val PROXIMITY_RECORD_BYTES = HubBluetoothProximityAdvertiser.PROXIMITY_HINT_BYTES + 1
        const val MAX_STAFF_DIRECTORY = 256
        const val MAX_SESSION_ENVELOPE_CHARS = 128 * 1024
    }
}
