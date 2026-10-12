package com.theplugos.cashierhub.native

import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.DefaultSSLWebSocketServerFactory
import org.java_websocket.server.WebSocketServer
import org.json.JSONArray
import org.json.JSONObject
import java.net.InetSocketAddress
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import java.util.UUID
import javax.net.ssl.SSLContext

/**
 * TLS-only local transport. Device identities are authenticated again at the
 * application protocol layer with a signed nonce; a LAN address is never used
 * as identity. This class is not started until enrollment provides verified TLS
 * material and an active authorization bundle.
 */
class AuthenticatedLocalWebSocketTransport(
    private val verifier: HubCommandVerifier,
    private val commandHandler: (JSONObject) -> HubReceipt,
    private val terminalSessionHandler: (String, JSONObject) -> TerminalStaffSessionInstallReceipt,
    private val terminalStaffDirectoryHandler: (String) -> List<StaffDirectoryRecord>,
    private val terminalOperatorContextHandler: (String, String) -> NativeOperatorContext,
) {
    @Volatile
    private var server: WebSocketServer? = null
    private val challenges = ConcurrentHashMap<WebSocket, PendingChallenge>()
    private val authenticatedDevices = ConcurrentHashMap<WebSocket, String>()

    fun start(sslContext: SSLContext, port: Int = DEFAULT_PORT) {
        check(server == null) { "Local transport is already running." }
        val started = CountDownLatch(1)
        val startupFailure = AtomicReference<Exception?>(null)
        val socketServer = object : WebSocketServer(InetSocketAddress("0.0.0.0", port)) {
            override fun onOpen(connection: WebSocket, handshake: ClientHandshake) {
                val nonce = ByteArray(CHALLENGE_BYTES).also { SecureRandom().nextBytes(it) }
                challenges[connection] = PendingChallenge(nonce, System.currentTimeMillis() + CHALLENGE_TTL_MS)
                connection.send(
                    JSONObject()
                        .put("type", "CHALLENGE")
                        .put("nonce", HubWireEncoding.encode(nonce))
                        .put("expiresAtEpochMs", System.currentTimeMillis() + CHALLENGE_TTL_MS)
                        .toString()
                )
            }

            override fun onMessage(connection: WebSocket, message: String) {
                handleMessage(connection, message)
            }

            override fun onClose(connection: WebSocket, code: Int, reason: String?, remote: Boolean) {
                challenges.remove(connection)
                authenticatedDevices.remove(connection)
            }

            override fun onError(connection: WebSocket?, exception: Exception) {
                if (connection != null) {
                    challenges.remove(connection)
                    authenticatedDevices.remove(connection)
                } else {
                    startupFailure.compareAndSet(null, exception)
                    started.countDown()
                }
                // Raw transport exceptions are not sent over the network or
                // logged with payload details; callers only receive a safe error.
            }

            override fun onStart() {
                connectionLostTimeout = 20
                started.countDown()
            }
        }
        socketServer.setWebSocketFactory(DefaultSSLWebSocketServerFactory(sslContext))
        try {
            socketServer.start()
        } catch (error: Exception) {
            runCatching { socketServer.stop(1_000) }
            throw HubUnavailableException("The local TLS listener could not start.")
        }
        val didStart = try {
            started.await(START_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (error: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
        if (!didStart || startupFailure.get() != null) {
            runCatching { socketServer.stop(1_000) }
            throw HubUnavailableException("The local TLS listener did not become ready.")
        }
        server = socketServer
    }

    fun stop() {
        val active = server ?: return
        try {
            active.stop(1_000)
        } finally {
            server = null
            challenges.clear()
            authenticatedDevices.clear()
        }
    }

    fun connectedPeerCount(): Int = authenticatedDevices.size

    /** The Hub currently binds the protocol's fixed, cloud-approved local
     * port. Discovery publishes this only after `start` completed. */
    fun listeningPort(): Int = DEFAULT_PORT

    fun broadcastCommittedEvent(event: JSONObject) {
        val message = JSONObject().put("type", "EVENT_COMMITTED").put("event", event).toString()
        authenticatedDevices.keys.forEach { connection ->
            if (connection.isOpen) connection.send(message)
        }
    }

    private fun handleMessage(connection: WebSocket, rawMessage: String) {
        val message = try {
            JSONObject(rawMessage)
        } catch (_: Exception) {
            sendError(connection, "Invalid protocol message.")
            return
        }

        when (message.optString("type", "")) {
            "HELLO" -> authenticate(connection, message)
            "STAFF_DIRECTORY_REQUEST" -> sendTerminalStaffDirectory(connection)
            "STAFF_SESSION" -> installTerminalStaffSession(connection, message)
            "OPERATOR_CONTEXT_REQUEST" -> sendTerminalOperatorContext(connection, message)
            "COMMAND" -> acceptCommand(connection, message)
            else -> sendError(connection, "Unsupported protocol message.")
        }
    }

    private fun authenticate(connection: WebSocket, message: JSONObject) {
        val challenge = challenges[connection]
        val deviceId = message.optString("deviceId", "").trim()
        val signature = message.optString("signature", "").trim()
        if (challenge == null || challenge.expiresAtEpochMs < System.currentTimeMillis() || deviceId.isEmpty() || signature.isEmpty()) {
            sendError(connection, "The device challenge is missing or expired.")
            connection.close()
            return
        }
        if (!verifier.verifyTransportChallenge(deviceId, challenge.nonce, signature)) {
            sendError(connection, "Terminal authentication failed.")
            connection.close()
            return
        }
        challenges.remove(connection)
        authenticatedDevices[connection] = deviceId
        connection.send(JSONObject().put("type", "READY").put("deviceId", deviceId).toString())
    }

    /** The roster is a non-secret convenience projection from the currently
     * signed Hub bundle. The device has already passed the TLS challenge; this
     * does not issue a session or accept a command. */
    private fun sendTerminalStaffDirectory(connection: WebSocket) {
        val authenticatedDeviceId = authenticatedDevices[connection]
        if (authenticatedDeviceId == null) {
            sendError(connection, "Authenticate the terminal before requesting the staff directory.")
            return
        }
        try {
            val staff = terminalStaffDirectoryHandler(authenticatedDeviceId)
            val values = JSONArray()
            staff.forEach { entry ->
                values.put(JSONObject().put("staffId", entry.staffId).put("name", entry.name).put("role", entry.role))
            }
            connection.send(JSONObject().put("type", "STAFF_DIRECTORY").put("staff", values).toString())
        } catch (_: IllegalStateException) {
            sendError(connection, "The Hub cannot provide a terminal staff directory.")
        }
    }

    /** A cloud-signed compact assertion is accepted only from the same
     * terminal that passed HELLO. The Hub re-verifies issuer, branch, key,
     * role, expiry, and revocation facts before changing SQLCipher state. */
    private fun installTerminalStaffSession(connection: WebSocket, message: JSONObject) {
        val authenticatedDeviceId = authenticatedDevices[connection]
        if (authenticatedDeviceId == null) {
            sendError(connection, "Authenticate the terminal before starting a staff session.")
            return
        }
        try {
            val envelope = message.optJSONObject("envelope")
                ?: throw HubCommandRejectedException("Terminal staff-session envelope is required.")
            if (envelope.toString().length > MAX_SESSION_ENVELOPE_CHARS) {
                throw HubCommandRejectedException("Terminal staff-session envelope is too large.")
            }
            val receipt = terminalSessionHandler(authenticatedDeviceId, envelope)
            connection.send(
                JSONObject()
                    .put("type", "STAFF_SESSION_RESULT")
                    .put("sessionId", receipt.sessionId)
                    .put("role", receipt.role)
                    .put("expiresAt", receipt.expiresAt)
                    .toString()
            )
        } catch (_: IllegalStateException) {
            sendError(connection, "The Hub rejected the terminal staff session.")
        }
    }

    /** A context request is usable only after both local device proof and a
     * Hub-installed terminal staff session. The opaque session ID is matched
     * to the authenticated WebSocket device inside the runtime; it cannot move
     * an operator projection between terminals. */
    private fun sendTerminalOperatorContext(connection: WebSocket, message: JSONObject) {
        val authenticatedDeviceId = authenticatedDevices[connection]
        if (authenticatedDeviceId == null) {
            sendError(connection, "Authenticate the terminal before requesting task data.")
            return
        }
        try {
            val staffSessionId = UUID.fromString(message.optString("staffSessionId", "").trim()).toString()
            val context = terminalOperatorContextHandler(authenticatedDeviceId, staffSessionId)
            connection.send(
                JSONObject()
                    .put("type", "OPERATOR_CONTEXT")
                    .put("context", TerminalOperatorContextWire.encode(context))
                    .toString()
            )
        } catch (_: Exception) {
            sendError(connection, "The Hub rejected the terminal task-data request.")
        }
    }

    private fun acceptCommand(connection: WebSocket, message: JSONObject) {
        val authenticatedDeviceId = authenticatedDevices[connection]
        if (authenticatedDeviceId == null) {
            sendError(connection, "Authenticate the terminal before submitting a command.")
            return
        }
        try {
            val command = message.optJSONObject("command") ?: throw HubCommandRejectedException("Command envelope is required.")
            if (command.optString("deviceId", "") != authenticatedDeviceId) {
                throw HubCommandRejectedException("Command device identity does not match the authenticated terminal.")
            }
            val receipt = commandHandler(command)
            connection.send(receiptJson(receipt).toString())
        } catch (error: IllegalStateException) {
            sendError(connection, error.message ?: "The Hub rejected the command.")
        }
    }

    private fun receiptJson(receipt: HubReceipt): JSONObject = JSONObject()
        .put("type", "COMMAND_RESULT")
        .put("commandId", receipt.commandId)
        .put("outcome", receipt.outcome)
        .put("committedAt", receipt.committedAt)
        .put("eventIds", receipt.eventIds)
        .put("outboxIds", receipt.outboxIds)

    private fun sendError(connection: WebSocket, message: String) {
        if (connection.isOpen) connection.send(JSONObject().put("type", "ERROR").put("message", message).toString())
    }

    private data class PendingChallenge(val nonce: ByteArray, val expiresAtEpochMs: Long)

    private companion object {
        const val DEFAULT_PORT = 48652
        const val CHALLENGE_BYTES = 32
        const val CHALLENGE_TTL_MS = 30_000L
        const val START_TIMEOUT_MS = 5_000L
        const val MAX_SESSION_ENVELOPE_CHARS = 128 * 1024
    }
}
