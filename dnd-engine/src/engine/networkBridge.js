/**
 * networkBridge.js — WebSocket client for co-op multiplayer.
 *
 * DESIGN
 * ──────
 * The bridge wraps a single WebSocket connection and translates between the
 * wire protocol (JSON messages) and the internal event bus.
 *
 * USAGE
 * ──────
 *   // In actionDispatcher.js, swap the adapter:
 *   import { WebSocketAdapter } from './networkBridge.js';
 *   const NetworkAdapter = WebSocketAdapter;          // one line change
 *
 *   // To start a co-op session:
 *   import { networkBridge } from './networkBridge.js';
 *   await networkBridge.connect('wss://your-server/session/abc123');
 *
 * WIRE PROTOCOL (server ↔ client)
 * ──────────────────────────────
 * All messages are JSON objects with a `type` field:
 *
 *   Client → Server:
 *     { type: 'JOIN',         sessionId, playerName }
 *     { type: 'ACTION',       actionType, payload }
 *     { type: 'ROLL_REQUEST', id, notation }
 *     { type: 'PING' }
 *
 *   Server → Client:
 *     { type: 'SESSION_STATE', state }          — full state sync on join
 *     { type: 'STATE_PATCH',   patch }          — incremental state update
 *     { type: 'ROLL_RESULT',   id, result }     — dice roll resolution
 *     { type: 'TURN_CHANGED',  currentPlayerId }
 *     { type: 'PLAYER_JOIN',   player }
 *     { type: 'PLAYER_LEAVE',  playerId }
 *     { type: 'DM_NARRATION',  text }
 *     { type: 'ERROR',         message }
 *     { type: 'PONG' }
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "./eventBus.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL_MS = 25_000;

// ── State ─────────────────────────────────────────────────────────────────────

let _socket = null;
let _sessionUrl = null;
let _reconnectCount = 0;
let _pingTimer = null;
let _connected = false;

// Pending roll promises: id → { resolve, reject }
const _pendingRolls = new Map();

// ── Public API ────────────────────────────────────────────────────────────────

export const networkBridge = {
  /**
   * Connect to a multiplayer session server.
   * Resolves when the SESSION_STATE handshake is complete.
   *
   * @param {string} url       - WebSocket URL, e.g. 'wss://host/session/abc'
   * @param {string} playerName
   * @returns {Promise<void>}
   */
  connect(url, playerName) {
    _sessionUrl = url;

    return new Promise((resolve, reject) => {
      _socket = new WebSocket(url);

      _socket.addEventListener("open", () => {
        _connected = true;
        _reconnectCount = 0;
        console.log("[NetworkBridge] Connected to", url);

        // Send JOIN with the local player's name
        const state = gameStore.getState();
        _send({ type: "JOIN", playerName: playerName ?? state.player.name });

        // Keep-alive pings
        _pingTimer = setInterval(
          () => _send({ type: "PING" }),
          PING_INTERVAL_MS,
        );
      });

      _socket.addEventListener("message", (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          console.warn("[NetworkBridge] Bad JSON:", event.data);
          return;
        }

        _handleMessage(msg, resolve, reject);
      });

      _socket.addEventListener("close", (event) => {
        _connected = false;
        clearInterval(_pingTimer);
        console.warn(`[NetworkBridge] Disconnected (${event.code})`);

        eventBus.emit(EVENTS.PLAYER_DISCONNECTED, { code: event.code });
        gameStore.setState(
          {
            session: {
              ...gameStore.getState().session,
              mode: "solo",
              isMyTurn: true,
            },
          },
          "networkBridge:disconnect",
        );

        _attemptReconnect();
      });

      _socket.addEventListener("error", (err) => {
        console.error("[NetworkBridge] Socket error:", err);
        reject(err);
      });
    });
  },

  /** Gracefully close the connection and stop reconnecting. */
  disconnect() {
    _sessionUrl = null; // Prevents reconnect
    clearInterval(_pingTimer);
    _socket?.close(1000, "User disconnected");
    _socket = null;
    _connected = false;
  },

  /** Send a player action to the server. */
  sendAction(actionType, payload = {}) {
    _send({ type: "ACTION", actionType, payload });
  },

  /** @type {boolean} */
  get connected() {
    return _connected;
  },
};

// ── WebSocketAdapter ──────────────────────────────────────────────────────────

/**
 * Drop-in replacement for LocalAdapter in actionDispatcher.js.
 * Roll requests are sent to the server and resolved when the result arrives.
 *
 * To enable multiplayer:
 *   1. Call networkBridge.connect(url)
 *   2. In actionDispatcher.js change:
 *        const NetworkAdapter = LocalAdapter;
 *      to:
 *        import { WebSocketAdapter } from '../engine/networkBridge.js';
 *        const NetworkAdapter = WebSocketAdapter;
 */
export const WebSocketAdapter = {
  /**
   * @param {string} notation
   * @returns {Promise<import('../systems/diceSystem.js').RollResult>}
   */
  requestRoll(notation) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      _pendingRolls.set(id, { resolve, reject });
      _send({ type: "ROLL_REQUEST", id, notation });

      // Timeout safety — fall back to local roll after 4s
      setTimeout(() => {
        if (_pendingRolls.has(id)) {
          console.warn(
            "[NetworkBridge] Roll timeout — falling back to local roll",
          );
          _pendingRolls.delete(id);
          import("../systems/diceSystem.js").then(({ roll }) =>
            resolve(roll(notation)),
          );
        }
      }, 4_000);
    });
  },
};

// ── Message handler ───────────────────────────────────────────────────────────

function _handleMessage(msg, onReady, onError) {
  switch (msg.type) {
    // Full state sync from server — merge into store
    case "SESSION_STATE": {
      if (msg.state) {
        // Merge server session state without blowing away local DM config
        const local = gameStore.getState();
        gameStore.setState(
          {
            player: msg.state.player ?? local.player,
            world: msg.state.world ?? local.world,
            combat: msg.state.combat ?? local.combat,
            session: {
              ...local.session,
              ...(msg.state.session ?? {}),
              mode: "coop",
            },
          },
          "networkBridge:sessionState",
        );
      }
      eventBus.emit(EVENTS.SESSION_JOINED, msg.state?.session);
      onReady?.();
      break;
    }

    // Incremental state patch from server
    case "STATE_PATCH": {
      if (msg.patch) {
        const current = gameStore.getState();
        // Deep-merge top-level slices
        const merged = {};
        for (const [key, val] of Object.entries(msg.patch)) {
          merged[key] =
            typeof val === "object" && !Array.isArray(val)
              ? { ...(current[key] ?? {}), ...val }
              : val;
        }
        gameStore.setState(merged, "networkBridge:statePatch");
      }
      break;
    }

    // Dice roll result from server
    case "ROLL_RESULT": {
      const pending = _pendingRolls.get(msg.id);
      if (pending) {
        _pendingRolls.delete(msg.id);
        pending.resolve(msg.result);
      }
      break;
    }

    // Turn order changed
    case "TURN_CHANGED": {
      const { session } = gameStore.getState();
      const isMyTurn = msg.currentPlayerId === session.localPlayerId;
      gameStore.setState(
        {
          session: {
            ...session,
            currentTurnPlayerId: msg.currentPlayerId,
            isMyTurn,
          },
        },
        "networkBridge:turnChanged",
      );
      eventBus.emit(EVENTS.SESSION_TURN_CHANGED, msg);
      break;
    }

    // Another player joined
    case "PLAYER_JOIN": {
      const state = gameStore.getState();
      const players = [...(state.session.players ?? [])];
      const idx = players.findIndex((p) => p.id === msg.player?.id);
      if (idx >= 0) players[idx] = msg.player;
      else players.push(msg.player);
      gameStore.setState(
        { session: { ...state.session, players } },
        "networkBridge:playerJoin",
      );
      eventBus.emit(EVENTS.PLAYER_CONNECTED, msg.player);
      break;
    }

    // A player left
    case "PLAYER_LEAVE": {
      const state = gameStore.getState();
      gameStore.setState(
        {
          session: {
            ...state.session,
            players: state.session.players.filter((p) => p.id !== msg.playerId),
          },
        },
        "networkBridge:playerLeave",
      );
      eventBus.emit(EVENTS.PLAYER_DISCONNECTED, { playerId: msg.playerId });
      break;
    }

    // DM narration pushed from server (server-side DM mode)
    case "DM_NARRATION": {
      const state = gameStore.getState();
      const entry = { role: "dm", text: msg.text, timestamp: Date.now() };
      gameStore.setState(
        {
          dm: { ...state.dm, narrativeLog: [...state.dm.narrativeLog, entry] },
        },
        "networkBridge:dmNarration",
      );
      eventBus.emit(EVENTS.DM_RESPONSE_RECEIVED, entry);
      break;
    }

    case "PONG":
      break; // Keep-alive response, no action needed

    case "ERROR": {
      console.error("[NetworkBridge] Server error:", msg.message);
      onError?.(new Error(msg.message));
      break;
    }

    default:
      console.warn("[NetworkBridge] Unknown message type:", msg.type);
  }
}

// ── Reconnect ─────────────────────────────────────────────────────────────────

function _attemptReconnect() {
  if (!_sessionUrl || _reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
    console.warn("[NetworkBridge] Reconnect abandoned.");
    return;
  }

  _reconnectCount++;
  const delay = RECONNECT_DELAY_MS * _reconnectCount;
  console.log(
    `[NetworkBridge] Reconnecting in ${delay}ms (attempt ${_reconnectCount})…`,
  );

  setTimeout(() => {
    const state = gameStore.getState();
    networkBridge.connect(_sessionUrl, state.player.name).catch(() => {
      // _attemptReconnect is called again from the close handler
    });
  }, delay);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _send(msg) {
  if (_socket?.readyState === WebSocket.OPEN) {
    _socket.send(JSON.stringify(msg));
  } else {
    console.warn("[NetworkBridge] Cannot send — socket not open:", msg.type);
  }
}
