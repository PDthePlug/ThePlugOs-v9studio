package com.theplugos.cashierhub.native

import org.json.JSONObject
import java.util.UUID

data class TerminalOperationalCommandResult(
    val commandId: String,
    val outcome: String,
    val committedAt: String? = null,
    val error: String? = null,
)

/**
 * Native terminal command boundary. It persists one exact signed intent at a
 * time so a reconnect retry can reuse the same command ID, sequence, payload,
 * and signature. There is deliberately no Capacitor/browser method for this
 * class or its session/sequence material.
 */
class TerminalOperationalCommandClient(
    private val keys: TerminalKeyManager,
    private val sessions: TerminalStaffSessionCoordinator = TerminalStaffSessionCoordinator(keys),
) {
    fun submit(
        controller: TerminalLocalLinkController,
        commandId: String,
        type: String,
        payload: JSONObject,
        onResult: (TerminalOperationalCommandResult) -> Unit,
    ) {
        val intent = prepare(commandId, type, payload)
        controller.submitOperationalCommand(intent.toJson()) { result ->
            if (result.outcome in TERMINAL_FINAL_OUTCOMES) clearCompletedIntent(intent, result.outcome)
            onResult(result)
        }
    }

    fun retryPending(
        controller: TerminalLocalLinkController,
        commandId: String,
        onResult: (TerminalOperationalCommandResult) -> Unit,
    ) {
        val session = sessions.currentSession()
            ?: throw HubUnavailableException("A current native terminal staff session is required before retrying a command.")
        val intent = session.pendingCommand
            ?: throw HubCommandRejectedException("There is no pending terminal command to retry.")
        if (intent.commandId != requireUuid(commandId, "Terminal command ID")) {
            throw HubCommandRejectedException("The requested terminal command is not the pending signed intent.")
        }
        controller.submitOperationalCommand(intent.toJson()) { result ->
            if (result.outcome in TERMINAL_FINAL_OUTCOMES) clearCompletedIntent(intent, result.outcome)
            onResult(result)
        }
    }

    private fun prepare(commandIdValue: String, typeValue: String, payload: JSONObject): TerminalCommandIntent {
        val commandId = requireUuid(commandIdValue, "Terminal command ID")
        val type = typeValue.trim()
        if (type !in ALL_COMMAND_TYPES) throw HubCommandRejectedException("The terminal command type is not implemented by this release.")
        HubPayloadSafety.rejectSensitiveValues(payload)
        val session = sessions.currentSession()
            ?: throw HubUnavailableException("A current native terminal staff session is required before submitting a command.")
        if (type !in permissionsFor(session.role)) {
            throw HubCommandRejectedException("The verified ${session.role} terminal session cannot execute $type.")
        }
        session.pendingCommand?.let { pending ->
            if (pending.commandId == commandId && pending.type == type && pending.payloadBase64 == HubWireEncoding.encode(payload.toString().toByteArray(Charsets.UTF_8))) {
                return pending
            }
            throw HubUnavailableException("The terminal has an unfinalized signed command. Retry it before preparing another command.")
        }
        val sequence = try {
            Math.addExact(session.lastAllocatedSequence, 1L)
        } catch (_: ArithmeticException) {
            throw HubCommandRejectedException("The terminal command sequence is exhausted.")
        }
        val issuedAt = HubCloudTime.now()
        val payloadBase64 = HubWireEncoding.encode(payload.toString().toByteArray(Charsets.UTF_8))
        val unsigned = TerminalCommandIntent(
            commandId = commandId,
            type = type,
            issuedAt = issuedAt,
            deviceId = session.terminalDeviceId,
            staffSessionId = session.sessionId,
            sequence = sequence,
            payloadBase64 = payloadBase64,
            signature = "",
        )
        val signature = keys.sign(commandBytes(unsigned))
        val intent = unsigned.copy(signature = signature)
        keys.saveStaffSession(session.copy(lastAllocatedSequence = sequence, pendingCommand = intent))
        return intent
    }

    private fun clearCompletedIntent(intent: TerminalCommandIntent, outcome: String) {
        val session = sessions.currentSession() ?: return
        if (session.pendingCommand?.commandId != intent.commandId) return
        if (outcome !in TERMINAL_FINAL_OUTCOMES) return
        keys.saveStaffSession(session.copy(pendingCommand = null))
    }

    private fun commandBytes(intent: TerminalCommandIntent): ByteArray = listOf(
        intent.commandId,
        intent.type,
        intent.issuedAt,
        intent.deviceId,
        intent.staffSessionId,
        intent.sequence.toString(),
        intent.payloadBase64,
    ).joinToString("\u001F").toByteArray(Charsets.UTF_8)

    private fun permissionsFor(role: String): Set<String> = when (role) {
        "CASHIER" -> setOf("order.create", "order.status.transition", "payment.capture")
        "KITCHEN_STAFF" -> setOf("order.status.transition")
        "MANAGER" -> setOf("order.status.transition", "shift.open", "shift.close", "inventory.receive", "inventory.adjust", "inventory.waste")
        else -> emptySet()
    }

    private fun requireUuid(value: String, subject: String): String = try {
        UUID.fromString(value.trim()).toString()
    } catch (_: IllegalArgumentException) {
        throw HubCommandRejectedException("$subject must be a UUID.")
    }

    private companion object {
        val ALL_COMMAND_TYPES = setOf(
            "order.create", "order.status.transition", "payment.capture", "shift.open", "shift.close",
            "inventory.receive", "inventory.adjust", "inventory.waste",
        )
        val TERMINAL_FINAL_OUTCOMES = setOf("APPLIED", "DUPLICATE", "REJECTED")
    }
}
