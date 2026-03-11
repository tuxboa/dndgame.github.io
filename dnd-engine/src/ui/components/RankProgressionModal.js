/**
 * RankProgressionModal.js
 *
 * Shows the player's rank, combat rounds played, and progress toward the
 * next rank tier. Uses dm.turnCount as the global "adventure rounds" counter.
 *
 * Usage:
 *   import { initRankModal } from './RankProgressionModal.js';
 *   initRankModal();         // attaches to button#rank-btn and modal slot
 *   initRankModal(triggerEl, mountEl); // custom trigger and container
 */

import { gameStore } from "../../store/index.js";

// ── Rank Tiers ────────────────────────────────────────────────────────────────
// Each entry: { id, label, minRounds, color, icon }

const RANKS = [
  {
    id: "peasant",
    label: "Közember",
    minRounds: 0,
    color: "#7a7465",
    icon: "🪚",
  },
  { id: "recruit", label: "Újonc", minRounds: 5, color: "#a0a090", icon: "⚔️" },
  {
    id: "adventurer",
    label: "Kalandor",
    minRounds: 15,
    color: "#4a9e6a",
    icon: "🗺️",
  },
  {
    id: "ranger",
    label: "Határőr",
    minRounds: 30,
    color: "#5b9abf",
    icon: "🏹",
  },
  { id: "hero", label: "Hős", minRounds: 60, color: "#7b68ee", icon: "🛡️" },
  {
    id: "veteran",
    label: "Veterán",
    minRounds: 100,
    color: "#c8922a",
    icon: "🪖",
  },
  {
    id: "champion",
    label: "Bajnok",
    minRounds: 200,
    color: "#e56a2f",
    icon: "🏆",
  },
  {
    id: "legend",
    label: "Legenda",
    minRounds: 350,
    color: "#9b2335",
    icon: "👑",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getRankInfo(rounds) {
  let current = RANKS[0];
  let next = RANKS[1];
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (rounds >= RANKS[i].minRounds) {
      current = RANKS[i];
      next = RANKS[i + 1] ?? null;
      break;
    }
  }
  const progress = next
    ? Math.min(
        1,
        (rounds - current.minRounds) / (next.minRounds - current.minRounds),
      )
    : 1;
  return { current, next, progress };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderRankRow(rank, isUnlocked, isCurrent, rounds) {
  return `
    <div class="rank-row${isCurrent ? " rank-row--current" : ""}${!isUnlocked ? " rank-row--locked" : ""}">
      <span class="rank-row-icon">${rank.icon}</span>
      <div class="rank-row-info">
        <span class="rank-row-name" style="color:${isUnlocked ? rank.color : "var(--color-text-dim,#7a7465)"}">${rank.label}</span>
        <span class="rank-row-req">
          ${
            isUnlocked
              ? isCurrent
                ? `<em>Jelenlegi rang</em>`
                : `✓ Elérve`
              : `${rank.minRounds} körből nyílik meg`
          }
        </span>
      </div>
      ${isCurrent ? `<span class="rank-badge-current">▶</span>` : ""}
    </div>`;
}

function _buildHTML(state) {
  const rounds = state.dm?.turnCount ?? 0;
  const playerName = state.player.name || "Kalandor";
  const { current, next, progress } = _getRankInfo(rounds);
  const pct = Math.round(progress * 100);

  const rankRows = RANKS.map((rank) => {
    const isUnlocked = rounds >= rank.minRounds;
    const isCurrent = rank.id === current.id;
    return _renderRankRow(rank, isUnlocked, isCurrent, rounds);
  }).join("");

  return `
    <div class="rank-modal-backdrop" id="rank-modal-backdrop">
      <div class="rank-modal" role="dialog" aria-modal="true" aria-label="Rang és Haladás">
        <button class="rank-modal-close" id="rank-modal-close" aria-label="Bezárás">✕</button>
        <h2 class="rank-modal-title">Rang és Haladás</h2>

        <div class="rank-hero-block">
          <span class="rank-hero-icon" style="color:${current.color}">${current.icon}</span>
          <div class="rank-hero-info">
            <p class="rank-hero-name">${playerName}</p>
            <p class="rank-hero-rank" style="color:${current.color}">${current.label}</p>
          </div>
          <div class="rank-hero-rounds">
            <p class="rank-rounds-num">${rounds}</p>
            <p class="rank-rounds-label">kör</p>
          </div>
        </div>

        ${
          next
            ? `
        <div class="rank-progress-block">
          <div class="rank-progress-labels">
            <span style="color:${current.color}">${current.label}</span>
            <span style="color:${next.color}">${next.label} (${next.minRounds} kör)</span>
          </div>
          <div class="rank-progress-bar-wrap">
            <div class="rank-progress-bar" style="width:${pct}%;background:${current.color}"></div>
          </div>
          <p class="rank-progress-pct">${pct}%</p>
        </div>`
            : `
        <div class="rank-progress-block">
          <p class="rank-max-label" style="color:${current.color}">⚜️ Maximális rang elérve</p>
        </div>`
        }

        <div class="rank-list">
          ${rankRows}
        </div>
      </div>
    </div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
.rank-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 12px;
}
.rank-modal {
  position: relative;
  background: var(--color-surface, #161619);
  border: 1px solid var(--color-border, #2d2d35);
  border-radius: var(--radius, 6px);
  width: 100%;
  max-width: 420px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 22px 20px 20px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.7);
  scrollbar-width: thin;
  scrollbar-color: var(--color-accent, #c8922a) transparent;
}
.rank-modal-close {
  position: absolute;
  top: 10px; right: 12px;
  background: none;
  border: none;
  color: var(--color-text-dim, #7a7465);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 6px;
  transition: color var(--transition, 0.18s ease);
}
.rank-modal-close:hover { color: var(--color-text, #d4c9b0); }
.rank-modal-title {
  font-family: var(--font-title, "Cinzel", serif);
  font-size: 18px;
  color: var(--color-accent, #c8922a);
  margin: 0 0 14px;
  letter-spacing: 1px;
  text-align: center;
}
.rank-hero-block {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--color-surface-2, #1e1e22);
  border-radius: var(--radius, 6px);
  padding: 14px;
  margin-bottom: 14px;
}
.rank-hero-icon { font-size: 36px; line-height: 1; }
.rank-hero-info { flex: 1; }
.rank-hero-name {
  font-family: var(--font-title, "Cinzel", serif);
  font-size: 14px;
  color: var(--color-text, #d4c9b0);
  margin: 0 0 2px;
}
.rank-hero-rank {
  font-family: var(--font-ui, system-ui, sans-serif);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin: 0;
}
.rank-hero-rounds { text-align: right; }
.rank-rounds-num {
  font-family: var(--font-title, "Cinzel", serif);
  font-size: 24px;
  color: var(--color-text, #d4c9b0);
  margin: 0;
  line-height: 1;
}
.rank-rounds-label {
  font-size: 10px;
  color: var(--color-text-dim, #7a7465);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin: 0;
}
.rank-progress-block { margin-bottom: 16px; }
.rank-progress-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-family: var(--font-ui, system-ui, sans-serif);
  margin-bottom: 5px;
}
.rank-progress-bar-wrap {
  height: 8px;
  background: var(--color-surface-2, #1e1e22);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--color-border, #2d2d35);
}
.rank-progress-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}
.rank-progress-pct {
  font-size: 10px;
  color: var(--color-text-dim, #7a7465);
  text-align: right;
  margin: 3px 0 0;
}
.rank-max-label {
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  margin: 0;
}
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rank-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--radius, 6px);
  background: var(--color-surface-2, #1e1e22);
  opacity: 0.5;
}
.rank-row--locked { opacity: 0.35; }
.rank-row:not(.rank-row--locked) { opacity: 1; }
.rank-row--current {
  border: 1px solid var(--color-accent, #c8922a);
  opacity: 1;
}
.rank-row-icon { font-size: 18px; width: 24px; text-align: center; }
.rank-row-info { flex: 1; }
.rank-row-name { display: block; font-size: 13px; font-weight: 700; font-family: var(--font-ui, system-ui, sans-serif); }
.rank-row-req { display: block; font-size: 10px; color: var(--color-text-dim, #7a7465); margin-top: 1px; }
.rank-row-req em { color: var(--color-accent, #c8922a); font-style: normal; }
.rank-badge-current { color: var(--color-accent, #c8922a); font-size: 14px; }
`;

let _cssInjected = false;
function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const el = document.createElement("style");
  el.id = "rank-modal-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ── Mount / unmount ───────────────────────────────────────────────────────────

let _backdropEl = null;

function _open() {
  if (_backdropEl) return;
  const div = document.createElement("div");
  div.innerHTML = _buildHTML(gameStore.getState());
  _backdropEl = div.firstElementChild;
  document.body.appendChild(_backdropEl);

  _backdropEl
    .querySelector("#rank-modal-close")
    ?.addEventListener("click", _close);
  _backdropEl.addEventListener("click", (e) => {
    if (e.target === _backdropEl) _close();
  });
}

function _close() {
  _backdropEl?.remove();
  _backdropEl = null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * initialise the rank modal.
 *
 * @param {HTMLElement} [triggerEl]   — element to attach click handler to (defaults to #rank-btn)
 * @returns {{ open: Function, close: Function }}
 */
export function initRankModal(triggerEl) {
  _injectCSS();

  const trigger = triggerEl ?? document.getElementById("rank-btn");
  trigger?.addEventListener("click", _open);

  return { open: _open, close: _close };
}
