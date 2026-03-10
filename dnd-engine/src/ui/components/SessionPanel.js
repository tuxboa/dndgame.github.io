/**
 * SessionPanel.js — Co-op session management UI.
 *
 * Two modes:
 *   HOST  — Displays a generated session code and WebSocket URL the player
 *            can share. Once a server URL is known, fill EXAMPLE_SERVER_URL.
 *   JOIN  — Enter a WS URL + display name → calls networkBridge.connect().
 *
 * The panel shows live connection status and lists connected players.
 *
 * NOTE: networkBridge functionality requires a running WebSocket server.
 *       The UI works without one — it shows "offline" status gracefully.
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";
import { networkBridge } from "../../engine/networkBridge.js";

// Replace with your actual server base URL when you have one
const EXAMPLE_SERVER_URL = "wss://your-server.example.com/session";

let _activeTab = "join";
let _isOpen = false;

// ── Public API ────────────────────────────────────────────────────────────────

export function initSessionPanel() {
  const panel = document.createElement("div");
  panel.id = "session-panel";
  panel.className = "modal-overlay hidden";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Co-op Session");

  panel.innerHTML = `
    <div class="modal session-modal">
      <div class="sp-header">
        <h2 class="sp-title">🌐 Co-op Session</h2>
        <button id="btn-close-session" class="cs-close" title="Close">✕</button>
      </div>

      <!-- Tab bar -->
      <div class="sp-tabs" role="tablist">
        <button class="sp-tab sp-tab--active" id="sp-tab-join" data-tab="join" role="tab">Join</button>
        <button class="sp-tab" id="sp-tab-host" data-tab="host" role="tab">Host</button>
      </div>

      <!-- Status badge -->
      <div class="sp-status" id="sp-status">
        <span class="sp-status-dot sp-status--offline"></span>
        <span id="sp-status-text">Offline — singleplayer mode</span>
      </div>

      <!-- JOIN tab -->
      <div class="sp-pane" id="sp-pane-join">
        <label class="form-label">
          Session URL
          <input
            id="sp-url-input"
            class="form-input"
            type="text"
            placeholder="${EXAMPLE_SERVER_URL}/abc123"
            autocomplete="off"
          />
        </label>
        <label class="form-label">
          Display Name
          <input
            id="sp-name-input"
            class="form-input"
            type="text"
            placeholder="Aldric"
            maxlength="30"
            autocomplete="off"
          />
        </label>
        <div class="modal-actions">
          <button id="btn-sp-connect" class="btn-primary">Connect</button>
          <button id="btn-sp-disconnect" class="btn-secondary sp-hidden">Disconnect</button>
        </div>
      </div>

      <!-- HOST tab -->
      <div class="sp-pane sp-hidden" id="sp-pane-host">
        <p class="sp-hint">
          Share this URL with friends. They paste it in the <em>Join</em> tab.
          Requires a compatible WebSocket server.
        </p>
        <div class="sp-code-row">
          <input
            id="sp-session-code"
            class="form-input sp-code-input"
            readonly
            type="text"
          />
          <button id="btn-sp-copy" class="btn-secondary sp-copy-btn" title="Copy URL">⬜ Copy</button>
        </div>
        <button id="btn-sp-new-code" class="btn-secondary sp-full-btn">↺ New code</button>
        <p class="sp-hint sp-hint--small">
          To run a server: <code>npx dnd-session-server</code>
          (or any WS server that speaks the Dark RPG protocol).
        </p>
      </div>

      <!-- Connected players list -->
      <div class="sp-players" id="sp-players"></div>
    </div>
  `;

  document.body.appendChild(panel);

  _wireEvents();
  _generateCode();
  _refreshStatus();

  // Update player list + status badge on session changes
  gameStore.select(
    (s) => s.session,
    () => {
      if (_isOpen) {
        _refreshStatus();
        _renderPlayers();
      }
    },
  );

  eventBus.on(EVENTS.PLAYER_CONNECTED, () => {
    if (_isOpen) _renderPlayers();
  });
  eventBus.on(EVENTS.PLAYER_DISCONNECTED, () => {
    if (_isOpen) _refreshStatus();
    _renderPlayers();
  });
}

export function openSessionPanel() {
  _isOpen = true;
  document.getElementById("session-panel")?.classList.remove("hidden");
  _switchTab(_activeTab); // restore whichever tab was last active
  _refreshStatus();
  _renderPlayers();
}

export function closeSessionPanel() {
  _isOpen = false;
  document.getElementById("session-panel")?.classList.add("hidden");
}

export function toggleSessionPanel() {
  _isOpen ? closeSessionPanel() : openSessionPanel();
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _wireEvents() {
  document
    .getElementById("btn-close-session")
    ?.addEventListener("click", closeSessionPanel);

  // Close on backdrop click
  document.getElementById("session-panel")?.addEventListener("click", (e) => {
    if (e.target === document.getElementById("session-panel"))
      closeSessionPanel();
  });

  // Tabs
  document.querySelectorAll(".sp-tab").forEach((tab) => {
    tab.addEventListener("click", () => _switchTab(tab.dataset.tab));
  });

  // Connect button
  document
    .getElementById("btn-sp-connect")
    ?.addEventListener("click", _handleConnect);

  // Disconnect button
  document
    .getElementById("btn-sp-disconnect")
    ?.addEventListener("click", () => {
      networkBridge.disconnect();
      _refreshStatus();
    });

  // Copy button
  document.getElementById("btn-sp-copy")?.addEventListener("click", () => {
    const input = document.getElementById("sp-session-code");
    if (!input) return;
    navigator.clipboard?.writeText(input.value).then(() => {
      const btn = document.getElementById("btn-sp-copy");
      if (btn) {
        btn.textContent = "✓ Copied";
        setTimeout(() => {
          btn.textContent = "⬜ Copy";
        }, 2000);
      }
    });
  });

  // New code button
  document
    .getElementById("btn-sp-new-code")
    ?.addEventListener("click", _generateCode);

  // Pre-fill name from store
  const player = gameStore.getState().player;
  const nameInput = document.getElementById("sp-name-input");
  if (nameInput && player.name) nameInput.value = player.name;
}

function _switchTab(tab) {
  _activeTab = tab;
  document.querySelectorAll(".sp-tab").forEach((t) => {
    t.classList.toggle("sp-tab--active", t.dataset.tab === tab);
  });
  document
    .getElementById("sp-pane-join")
    ?.classList.toggle("sp-hidden", tab !== "join");
  document
    .getElementById("sp-pane-host")
    ?.classList.toggle("sp-hidden", tab !== "host");
}

async function _handleConnect() {
  const url = document.getElementById("sp-url-input")?.value.trim();
  const name =
    document.getElementById("sp-name-input")?.value.trim() ||
    gameStore.getState().player.name ||
    "Player";

  if (!url) {
    document.getElementById("sp-url-input")?.focus();
    return;
  }

  const btn = document.getElementById("btn-sp-connect");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Connecting…";
  }

  try {
    await networkBridge.connect(url, name);
    _refreshStatus();
    _renderPlayers();
  } catch (err) {
    console.error("[SessionPanel] Connect failed:", err);
    _refreshStatus();
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: "Could not connect to session server.",
      type: "error",
      ttl: 5000,
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Connect";
    }
  }
}

function _generateCode() {
  const code = crypto.randomUUID().slice(0, 8);
  const input = document.getElementById("sp-session-code");
  if (input) input.value = `${EXAMPLE_SERVER_URL}/${code}`;
}

function _refreshStatus() {
  const connected = networkBridge.connected;
  const session = gameStore.getState().session;
  const dot = document.querySelector(".sp-status-dot");
  const text = document.getElementById("sp-status-text");
  const disc = document.getElementById("btn-sp-disconnect");

  if (!dot || !text) return;

  const isCoop = session.mode === "coop" && connected;

  dot.className = `sp-status-dot ${isCoop ? "sp-status--online" : "sp-status--offline"}`;
  text.textContent = isCoop
    ? `Connected — ${session.players?.length ?? 1} player(s)`
    : "Offline — singleplayer mode";

  disc?.classList.toggle("sp-hidden", !connected);
}

function _renderPlayers() {
  const container = document.getElementById("sp-players");
  if (!container) return;

  const players = gameStore.getState().session.players ?? [];
  if (players.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <p class="sp-players-label">Connected players</p>
    <ul class="sp-player-list">
      ${players
        .map(
          (p) => `
        <li class="sp-player-row">
          <span class="sp-player-dot ${p.isConnected !== false ? "sp-status--online" : "sp-status--offline"}"></span>
          <span class="sp-player-name">${p.name ?? "Unknown"}</span>
          ${!p.isConnected ? `<span class="sp-player-status">disconnected</span>` : ""}
        </li>`,
        )
        .join("")}
    </ul>
  `;
}
