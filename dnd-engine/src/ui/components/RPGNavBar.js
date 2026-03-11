/**
 * RPGNavBar.js
 *
 * A sticky navigation bar with D&D-flavoured panel buttons:
 *   INVENTORY · SPELLS · SPELLBOOK · BOONS
 *
 * Clicking a button updates ui.activePanel in gameStore and
 * emits an EVENTS.UI_PANEL_CHANGE event so other components can react.
 *
 * Usage:
 *   import { initRPGNavBar } from './RPGNavBar.js';
 *   initRPGNavBar();                 // mounts into <div id="rpg-navbar">
 *   initRPGNavBar(myContainer);     // or into a custom element
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";

const PANELS = [
  { id: "inventory",  label: "LELTÁR",    icon: "🎒" },
  { id: "spells",     label: "VARÁZSLATOK", icon: "✨" },
  { id: "spellbook",  label: "VARÁZSKÖNYV", icon: "📖" },
  { id: "boons",      label: "ÁLDÁSOK",    icon: "🏅" },
];

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
#rpg-navbar {
  position: relative;
  width: 100%;
  background: var(--color-surface, #161619);
  border-top: 1px solid var(--color-border, #2d2d35);
  box-shadow: 0 -2px 12px rgba(0,0,0,0.5);
  z-index: 90;
}
.rpg-navbar-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}
.rpg-navbar-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px 4px 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  position: relative;
  transition: background var(--transition, 0.18s ease);
  border-right: 1px solid var(--color-border, #2d2d35);
  outline: none;
}
.rpg-navbar-btn:last-child { border-right: none; }
.rpg-navbar-btn:hover { background: var(--color-surface-2, #1e1e22); }
.rpg-navbar-btn.active {
  background: var(--color-surface-2, #1e1e22);
}
.rpg-navbar-btn.active::after {
  content: "";
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 2px;
  background: var(--color-accent, #c8922a);
  border-radius: 2px 2px 0 0;
}
.rpg-navbar-icon {
  font-size: 18px;
  line-height: 1;
}
.rpg-navbar-label {
  font-family: var(--font-ui, system-ui, sans-serif);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.8px;
  color: var(--color-text-dim, #7a7465);
  text-transform: uppercase;
}
.rpg-navbar-btn.active .rpg-navbar-label {
  color: var(--color-accent, #c8922a);
}
.rpg-navbar-badge {
  position: absolute;
  top: 5px; right: calc(50% - 18px);
  min-width: 16px; height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--color-danger, #9b2335);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  font-family: var(--font-ui, system-ui, sans-serif);
  display: flex;
  align-items: center;
  justify-content: center;
}
`;

let _cssInjected = false;
function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.id = "rpg-navbar-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _countEquippedBoons(state) {
  const boons = state.player.boons ?? state.player.activeEffects ?? [];
  return Array.isArray(boons) ? boons.filter((b) => !b._expired).length : 0;
}

function _render(container, state) {
  const active = state.ui?.activePanel ?? "inventory";
  const boonCount = _countEquippedBoons(state);

  container.innerHTML = `
    <nav class="rpg-navbar-grid" role="navigation" aria-label="Fő menü">
      ${PANELS.map((p) => {
        const isActive = p.id === active;
        const showBadge = p.id === "boons" && boonCount > 0;
        return `
          <button class="rpg-navbar-btn${isActive ? " active" : ""}"
            data-panel="${p.id}"
            aria-pressed="${isActive}"
            aria-label="${p.label}">
            <span class="rpg-navbar-icon">${p.icon}</span>
            <span class="rpg-navbar-label">${p.label}</span>
            ${showBadge ? `<span class="rpg-navbar-badge">${boonCount}</span>` : ""}
          </button>`;
      }).join("")}
    </nav>`;

  container.querySelectorAll(".rpg-navbar-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const panelId = btn.dataset.panel;
      gameStore.setState({ ui: { ...gameStore.getState().ui, activePanel: panelId } });
      eventBus.emit(EVENTS.UI_PANEL_CHANGED ?? "ui:panelChanged", { panel: panelId });
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise and mount the navbar.
 *
 * @param {HTMLElement} [customContainer] — defaults to #rpg-navbar in the DOM
 * @returns {() => void} cleanup / unsubscribe
 */
export function initRPGNavBar(customContainer) {
  _injectCSS();

  let container = customContainer;
  if (!container) {
    container = document.getElementById("rpg-navbar");
    if (!container) {
      container = document.createElement("div");
      container.id = "rpg-navbar";
      document.body.appendChild(container);
    }
  }

  const unsub = gameStore.subscribe((state) => _render(container, state));
  _render(container, gameStore.getState());

  return unsub;
}
