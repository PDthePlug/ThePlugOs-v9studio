package com.theplugos.cashierhub.native

import org.java_websocket.client.WebSocketClient

/**
 * Java-WebSocket 1.6 exposes open/closed state but no isConnecting helper.
 * Treat every socket that is neither open nor closed as still in-flight so a
 * second discovery result cannot race a connection that is being established
 * or torn down.
 */
internal val WebSocketClient.isConnecting: Boolean
    get() = !isOpen && !isClosed
