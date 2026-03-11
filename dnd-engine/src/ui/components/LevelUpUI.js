/**
 * LevelUpUI.js — Level-up congratulations modal.
 *
 * Listens for EVENTS.LEVEL_UP_READY (emitted by levelUpSystem.addXp).
 * Shows:
 *   • New level badge and heading
 *   • Automatic bonuses (+5 Max HP / +2 Max MP / proficiency increase / class bonuses / new spells)
 *   • Six stat-improvement buttons (STR, DEX, CON, INT, WIS, CHA)
 *   • Optional feat panel (toggle)
 *
 * The player must click a stat or a feat — the modal cannot be dismissed any other way.
 */

import { eventBus, EVENTS } from "../../engine/eventBus.js";
import { applyLevelUp, applyMagicalSecret } from "../../systems/levelUpSystem.js";
import { FEATS } from "../../data/feats.js";
import { gameStore } from "../../store/index.js";

export function initLevelUpUI() {
  eventBus.on(EVENTS.LEVEL_UP_READY, (payload) => {
    _mountModal(payload);
  });

  eventBus.on(EVENTS.MAGICAL_SECRETS_READY, (payload) => {
    _mountMagicalSecretsPicker(payload);
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STAT_CHOICES = [
  {
    stat: "str",
    icon: "⚔️",
    label: "Strength",
    hint: "Hit harder, carry more",
  },
  {
    stat: "dex",
    icon: "🏹",
    label: "Dexterity",
    hint: "Strike first, dodge better",
  },
  {
    stat: "con",
    icon: "🩺",
    label: "Constitution",
    hint: "More HP, tougher saves",
  },
  {
    stat: "int",
    icon: "📚",
    label: "Intelligence",
    hint: "Sharper spells, keener mind",
  },
  {
    stat: "wis",
    icon: "🦉",
    label: "Wisdom",
    hint: "Better healing, sharper senses",
  },
  {
    stat: "cha",
    icon: "🎭",
    label: "Charisma",
    hint: "Lead with presence and effect",
  },
];

// ── Modal mount ───────────────────────────────────────────────────────────────

function _mountModal(payload) {
  const {
    newLevel = 2,
    classBonuses = [],
    newSpells = [],
    newProfBonus = null,
    oldProfBonus = null,
  } = payload ?? {};

  // Remove any stale instance
  document.querySelector("#levelup-overlay")?.remove();

  // ── Build automatic-bonuses rows ─────────────────────────────────────────
  const bonusRows = [
    `<div class="levelup-bonus-row">
       <span class="levelup-bonus-icon">❤️</span>
       <span class="levelup-bonus-label">Max HP</span>
       <span class="levelup-bonus-value">+5 &amp; Fully Restored</span>
     </div>`,
    `<div class="levelup-bonus-row">
       <span class="levelup-bonus-icon">🔮</span>
       <span class="levelup-bonus-label">Max MP</span>
       <span class="levelup-bonus-value">+2 &amp; Fully Restored</span>
     </div>`,
  ];

  if (newProfBonus && oldProfBonus && newProfBonus > oldProfBonus) {
    bonusRows.push(
      `<div class="levelup-bonus-row levelup-bonus-row--highlight">
         <span class="levelup-bonus-icon">🗡️</span>
         <span class="levelup-bonus-label">Proficiency Bonus</span>
         <span class="levelup-bonus-value">+${oldProfBonus} → +${newProfBonus}</span>
       </div>`,
    );
  }

  for (const desc of classBonuses) {
    bonusRows.push(
      `<div class="levelup-bonus-row">
         <span class="levelup-bonus-icon">⭐</span>
         <span class="levelup-bonus-label levelup-bonus-label--class">${desc}</span>
       </div>`,
    );
  }

  for (const spellName of newSpells) {
    bonusRows.push(
      `<div class="levelup-bonus-row">
         <span class="levelup-bonus-icon">✨</span>
         <span class="levelup-bonus-label">New Spell</span>
         <span class="levelup-bonus-value">${spellName}</span>
       </div>`,
    );
  }

  // ── Feat buttons ─────────────────────────────────────────────────────────
  const player = gameStore.getState().player;
  const takenFeats = new Set(player.feats ?? []);
  const validFeats = Object.values(FEATS).filter(
    (f) => !takenFeats.has(f.id) && (!f.prereq || f.prereq(player)),
  );

  const featBtns = validFeats.length
    ? validFeats
        .map(
          (f) => `
        <button class="levelup-feat-btn" data-feat="${f.id}">
          <span class="lfb-icon">${f.icon ?? "🌟"}</span>
          <span class="lfb-body">
            <span class="lfb-name">${f.name}</span>
            <span class="lfb-desc">${f.description}</span>
            ${f.prereqLabel ? `<span class="lfb-prereq">${f.prereqLabel}</span>` : ""}
          </span>
        </button>`,
        )
        .join("")
    : `<p class="levelup-no-feats">No feats available for your build right now.</p>`;

  // ── Stat buttons ─────────────────────────────────────────────────────────
  const statBtns = STAT_CHOICES.map(
    ({ stat, icon, label, hint }) => `
    <button class="levelup-stat-btn" data-stat="${stat}">
      <span class="lsb-icon">${icon}</span>
      <span class="lsb-body">
        <span class="lsb-label">+1 ${label}</span>
        <span class="lsb-hint">${hint}</span>
      </span>
    </button>`,
  ).join("");

  // ── Full markup ──────────────────────────────────────────────────────────
  const overlay = document.createElement("div");
  overlay.id = "levelup-overlay";
  overlay.className = "levelup-overlay";

  overlay.innerHTML = `
    <div class="levelup-card" role="dialog" aria-modal="true" aria-label="Level Up">

      <!-- Badge -->
      <div class="levelup-badge-wrap">
        <div class="levelup-badge">
          <span class="levelup-badge-num">${newLevel}</span>
        </div>
      </div>

      <h2 class="levelup-title">Level Up!</h2>
      <p class="levelup-subtitle">You have grown stronger, adventurer.</p>

      <!-- Automatic bonuses -->
      <div class="levelup-bonuses">
        ${bonusRows.join("\n")}
      </div>

      <!-- Stat choice -->
      <p class="levelup-choose-label">Choose one ability to improve:</p>
      <div class="levelup-stat-btns">
        ${statBtns}
      </div>

      <!-- Feat toggle -->
      ${validFeats.length ? `<button class="levelup-feat-toggle" id="lu-feat-toggle">✨ Choose a Feat instead</button>` : ""}

      <!-- Feat panel (hidden by default) -->
      <div class="levelup-feat-panel" id="lu-feat-panel">
        ${featBtns}
      </div>

    </div>
  `;

  document.body.appendChild(overlay);

  // Entrance animation
  requestAnimationFrame(() =>
    overlay.classList.add("levelup-overlay--visible"),
  );

  // ── Stat buttons ─────────────────────────────────────────────────────────
  overlay.querySelectorAll(".levelup-stat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.add("levelup-stat-btn--chosen");
      setTimeout(() => {
        applyLevelUp(btn.dataset.stat);
        _dismiss(overlay);
      }, 350);
    });
  });

  // ── Feat toggle ───────────────────────────────────────────────────────────
  const toggle = overlay.querySelector("#lu-feat-toggle");
  const panel = overlay.querySelector("#lu-feat-panel");
  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      const open = panel.classList.toggle("open");
      toggle.textContent = open
        ? "🗡️ Choose an Ability instead"
        : "✨ Choose a Feat instead";
      overlay
        .querySelectorAll(".levelup-stat-btns, .levelup-choose-label")
        .forEach((el) => el.classList.toggle("levelup--hidden", open));
    });
  }

  // ── Feat buttons ──────────────────────────────────────────────────────────
  overlay.querySelectorAll(".levelup-feat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.add("levelup-feat-btn--chosen");
      setTimeout(() => {
        applyLevelUp("feat:" + btn.dataset.feat);
        _dismiss(overlay);
      }, 350);
    });
  });
}

// ── Dismiss ───────────────────────────────────────────────────────────────────

function _dismiss(overlay) {
  overlay.classList.add("levelup-overlay--exit");
  overlay.addEventListener("animationend", () => overlay.remove(), {
    once: true,
  });
}

// ── Magical Secrets spell picker ──────────────────────────────────────────────

/**
 * Show a modal where the Bard picks 2 spells from ANY class.
 * Called when MAGICAL_SECRETS_READY fires after reaching Bard level 9.
 */
function _mountMagicalSecretsPicker({ count, availableSpells }) {
  let remaining = count;

  const overlay = document.createElement("div");
  overlay.id = "magical-secrets-overlay";
  overlay.className = "levelup-overlay magical-secrets-overlay";

  const rebuild = () => {
    const knownSpells = new Set(gameStore.getState().player.knownSpells ?? []);
    const rows = availableSpells
      .filter((s) => !knownSpells.has(s.id))
      .map((s) => `
        <button class="ms-spell-btn" data-spell-id="${s.id}">
          <span class="ms-spell-name">${s.name}</span>
          ${s.description ? `<span class="ms-spell-desc">${s.description}</span>` : ""}
        </button>`)
      .join("");

    overlay.innerHTML = `
      <div class="levelup-card ms-card" role="dialog" aria-modal="true">
        <h2 class="levelup-title">✨ Magical Secrets</h2>
        <p class="levelup-subtitle">Choose <strong>${remaining}</strong> spell${remaining !== 1 ? "s" : ""} from any class list.</p>
        <div class="ms-spell-list">
          ${rows || "<p class='levelup-subtitle'>No new spells available.</p>"}
        </div>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("levelup-overlay--visible"));

    overlay.querySelectorAll(".ms-spell-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const spellId = btn.dataset.spellId;
        applyMagicalSecret(spellId);
        remaining -= 1;
        if (remaining <= 0) {
          overlay.classList.add("levelup-overlay--exit");
          overlay.addEventListener("animationend", () => overlay.remove(), { once: true });
        } else {
          overlay.remove();
          rebuild();
        }
      });
    });
  };

  rebuild();
}
