/**
 * CharacterSheet.js
 *
 * Slide-in panel that renders a complete D&D 5e character sheet from store state.
 *
 * Sections:
 *   • Identity    — name, race, class, level, XP
 *   • Vitals      — HP bar, AC, initiative, speed, proficiency bonus, HD
 *   • Ability scores — 6 scores with modifiers + saving throw badges
 *   • Skills       — All 18 skills with prof/expertise indicators and totals
 *   • Conditions   — Active status effects
 *   • Spell slots  — Collapsible; hidden for non-casters
 *   • Equipped     — Items marked equipped from inventory
 *
 * Auto-updates whenever the player slice changes.
 */

import { gameStore } from "../../store/index.js";
import { EQUIPMENT_TEMPLATES, EQUIPMENT_SLOTS } from "../../data/equipment.js";
import { SPELLS } from "../../data/spells.js";

// ── D&D 5e constants ──────────────────────────────────────────────────────────

const ABILITY_SHORT = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

// Each skill: [display name, governing ability]
const SKILLS = [
  ["Acrobatics", "dex"],
  ["Animal Handling", "wis"],
  ["Arcana", "int"],
  ["Athletics", "str"],
  ["Deception", "cha"],
  ["History", "int"],
  ["Insight", "wis"],
  ["Intimidation", "cha"],
  ["Investigation", "int"],
  ["Medicine", "wis"],
  ["Nature", "int"],
  ["Perception", "wis"],
  ["Performance", "cha"],
  ["Persuasion", "cha"],
  ["Religion", "int"],
  ["Sleight of Hand", "dex"],
  ["Stealth", "dex"],
  ["Survival", "wis"],
];

// Saving throw ability per class (the two standard ones)
const WEAPON_PROFS = {
  Barbarian: "All simple & martial weapons",
  Bard: "Simple weapons, hand crossbows, longswords, rapiers, shortswords",
  Cleric: "Simple weapons",
  Druid:
    "Clubs, daggers, darts, javelins, maces, quarterstaffs, scimitars, sickles, slings, spears",
  Fighter: "All simple & martial weapons",
  Monk: "Simple weapons & shortswords",
  Paladin: "All simple & martial weapons",
  Ranger: "All simple & martial weapons",
  Rogue: "Simple weapons, hand crossbows, longswords, rapiers, shortswords",
  Sorcerer: "Daggers, darts, slings, quarterstaffs, light crossbows",
  Warlock: "Simple weapons",
  Wizard: "Daggers, darts, slings, quarterstaffs, light crossbows",
};

const ARMOR_PROFS = {
  Barbarian: "Light & medium armor, shields",
  Bard: "Light armor",
  Cleric: "Light, medium & heavy armor, shields",
  Druid: "Light & medium armor, shields (no metal)",
  Fighter: "All armor & shields",
  Monk: "None",
  Paladin: "All armor & shields",
  Ranger: "Light & medium armor, shields",
  Rogue: "Light armor",
  Sorcerer: "None",
  Warlock: "Light armor",
  Wizard: "None",
};

const CLASS_SAVES = {
  Barbarian: ["str", "con"],
  Bard: ["dex", "cha"],
  Cleric: ["wis", "cha"],
  Druid: ["int", "wis"],
  Fighter: ["str", "con"],
  Monk: ["str", "dex"],
  Paladin: ["wis", "cha"],
  Ranger: ["str", "dex"],
  Rogue: ["dex", "int"],
  Sorcerer: ["con", "cha"],
  Warlock: ["wis", "cha"],
  Wizard: ["int", "wis"],
};

// Classes that have spell slots
const CASTER_CLASSES = new Set([
  "Bard",
  "Cleric",
  "Druid",
  "Paladin",
  "Ranger",
  "Sorcerer",
  "Warlock",
  "Wizard",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function mod(score) {
  return Math.floor((score - 10) / 2);
}

function fmtMod(n) {
  return n >= 0 ? `+${n}` : `${n}`;
}

function hpPercent(hp, max) {
  if (!max) return 0;
  return Math.max(0, Math.min(100, (hp / max) * 100));
}

function hpColour(pct) {
  if (pct > 60) return "var(--color-success)";
  if (pct > 30) return "#b8832a";
  return "var(--color-danger)";
}

function skillKey(name) {
  return name.toLowerCase().replace(/\s+/g, "_");
}

// ── Public API ────────────────────────────────────────────────────────────────

let _isOpen = false;

export function initCharacterSheet() {
  const panel = document.createElement("aside");
  panel.id = "char-sheet-panel";
  panel.setAttribute("aria-label", "Character Sheet");
  panel.setAttribute("role", "complementary");
  document.body.appendChild(panel);

  // Subscribe — re-render whenever player slice changes
  gameStore.select(
    (s) => s.player,
    (player) => {
      if (_isOpen) _render(player);
    },
  );
}

export function openCharacterSheet() {
  _isOpen = true;
  const panel = document.getElementById("char-sheet-panel");
  if (!panel) return;
  panel.classList.add("open");
  _render(gameStore.getState().player);
}

export function closeCharacterSheet() {
  _isOpen = false;
  document.getElementById("char-sheet-panel")?.classList.remove("open");
}

export function toggleCharacterSheet() {
  _isOpen ? closeCharacterSheet() : openCharacterSheet();
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function _render(player) {
  const panel = document.getElementById("char-sheet-panel");
  if (!panel) return;

  const ab = player.abilities ?? {
    str: 10,
    dex: 10,
    con: 10,
    int: 10,
    wis: 10,
    cha: 10,
  };
  const prof = player.proficiencyBonus ?? 2;
  const saves = CLASS_SAVES[player.class] ?? [];
  const pct = hpPercent(player.hp, player.maxHp);
  const isCaster = CASTER_CLASSES.has(player.class);
  const initiative = mod(ab.dex);
  // Respect the movementSpeed field (set by Mobile feat etc.); fall back to race base
  const speed = player.movementSpeed ?? (player.race === "Dwarf" ? 25 : 30);

  panel.innerHTML = `
    <!-- Header row -->
    <div class="cs-header">
      <div class="cs-identity">
        <h2 class="cs-name">${player.name || "—"}</h2>
        <span class="cs-subtitle">${player.race || "—"} · ${player.class || "—"} · Level ${player.level}</span>
      </div>
      <button id="btn-close-sheet" class="cs-close" title="Close">✕</button>
    </div>

    <!-- Vitals strip -->
    <div class="cs-vitals">
      <div class="cs-vital-block cs-vital-hp">
        <span class="cs-vital-label">HP</span>
        <div class="cs-hp-track">
          <div class="cs-hp-fill" style="width:${pct}%;background:${hpColour(pct)}"></div>
        </div>
        <span class="cs-vital-value">${player.hp} / ${player.maxHp}</span>
      </div>
      <div class="cs-vital-block">
        <span class="cs-vital-label">AC</span>
        <span class="cs-vital-value cs-vital-big">${player.ac}</span>
      </div>
      <div class="cs-vital-block">
        <span class="cs-vital-label">Init</span>
        <span class="cs-vital-value cs-vital-big">${fmtMod(initiative)}</span>
      </div>
      <div class="cs-vital-block">
        <span class="cs-vital-label">Speed</span>
        <span class="cs-vital-value cs-vital-big">${speed} ft</span>
      </div>
      <div class="cs-vital-block">
        <span class="cs-vital-label">Prof</span>
        <span class="cs-vital-value cs-vital-big">${fmtMod(prof)}</span>
      </div>
      <div class="cs-vital-block">
        <span class="cs-vital-label">HD</span>
        <span class="cs-vital-value cs-vital-big">d${player.hitDie ?? 8}</span>
      </div>
    </div>

    <!-- Gold bar -->
    <div class="cs-gold">
      <span class="cs-gold-icon">◈</span>
      <span class="cs-gold-value">${player.gold ?? 0} gp</span>
    </div>

    <div class="cs-body">

      <!-- Ability Scores -->
      <section class="cs-section">
        <h3 class="cs-section-title">🎲 Ability Scores</h3>
        <div class="cs-ability-grid">
          ${Object.entries(ab)
            .map(([key, val]) => {
              const m = mod(val);
              const saveProf = saves.includes(key);
              const saveTotal = m + (saveProf ? prof : 0);
              return `
              <div class="cs-ability-cell">
                <span class="cs-ability-short">${ABILITY_SHORT[key]}</span>
                <span class="cs-ability-score">${val}</span>
                <span class="cs-ability-mod">${fmtMod(m)}</span>
                <span class="cs-save-badge${saveProf ? " proficient" : ""}" title="Saving throw: ${fmtMod(saveTotal)}">
                  ${saveProf ? "◆" : "◇"} ${fmtMod(saveTotal)}
                </span>
              </div>`;
            })
            .join("")}
        </div>
      </section>

      <!-- Saving Throws -->
      <section class="cs-section">
        <h3 class="cs-section-title">🛡️ Saving Throws</h3>
        <div class="cs-save-grid">
          ${Object.entries(ab)
            .map(([key, val]) => {
              const m = mod(val);
              const isProficient = saves.includes(key);
              const total = m + (isProficient ? prof : 0);
              return `
              <div class="cs-save-row${isProficient ? " cs-save-row--prof" : ""}">
                <span class="cs-save-pip${isProficient ? " proficient" : ""}">${isProficient ? "◆" : "◇"}</span>
                <span class="cs-save-name">${ABILITY_SHORT[key]}</span>
                <span class="cs-save-val">${fmtMod(total)}</span>
              </div>`;
            })
            .join("")}
        </div>
      </section>

      <!-- Skills -->
      <section class="cs-section">
        <h3 class="cs-section-title">🎯 Skills</h3>
        <ul class="cs-skill-list">
          ${SKILLS.map(([name, ability]) => {
            const key = skillKey(name);
            const skillData = player.skills?.[key] ?? {};
            const isProficient = skillData.proficient ?? false;
            const isExpertise = skillData.expertise ?? false;
            const base = mod(ab[ability] ?? 10);
            const bonus =
              base + (isExpertise ? prof * 2 : isProficient ? prof : 0);
            const pip = isExpertise ? "◆◆" : isProficient ? "◆" : "◇";
            const pipClass = isExpertise
              ? "expertise"
              : isProficient
                ? "proficient"
                : "";
            return `
              <li class="cs-skill-row">
                <span class="cs-skill-pip ${pipClass}" title="${isExpertise ? "Expertise" : isProficient ? "Proficiency" : "No proficiency"}">${pip}</span>
                <span class="cs-skill-name">${name}</span>
                <span class="cs-skill-ability">${ABILITY_SHORT[ability]}</span>
                <span class="cs-skill-bonus">${fmtMod(bonus)}</span>
              </li>`;
          }).join("")}
        </ul>
      </section>

      <!-- Proficiencies & Languages -->
      <section class="cs-section">
        <h3 class="cs-section-title">📋 Proficiencies &amp; Languages</h3>
        <div class="cs-prof-list">
          <div class="cs-prof-row">
            <span class="cs-prof-label">⚔️ Weapons</span>
            <span class="cs-prof-val">${WEAPON_PROFS[player.class] ?? "—"}</span>
          </div>
          <div class="cs-prof-row">
            <span class="cs-prof-label">🛡️ Armor</span>
            <span class="cs-prof-val">${ARMOR_PROFS[player.class] ?? "—"}</span>
          </div>
          <div class="cs-prof-row">
            <span class="cs-prof-label">🗣️ Languages</span>
            <span class="cs-prof-val">Common + one additional</span>
          </div>
        </div>
      </section>

      <!-- Conditions -->
      ${
        (player.conditions?.length ?? 0) > 0
          ? `
      <section class="cs-section">
        <h3 class="cs-section-title">⚠️ Conditions</h3>
        <div class="cs-conditions">
          ${player.conditions.map((c) => `<span class="cs-condition">${c}</span>`).join("")}
        </div>
      </section>`
          : ""
      }

      <!-- Mana / Spell capabilities (casters only) -->
      ${
        isCaster
          ? (() => {
              const mana = player.mana ?? 0;
              const maxMana = player.maxMana ?? 0;
              const manaPct =
                maxMana > 0 ? Math.round((mana / maxMana) * 100) : 0;
              const knownSpells = player.knownSpells ?? [];
              return `
      <section class="cs-section">
        <h3 class="cs-section-title">🔮 Mana &amp; Spells</h3>
        <div class="cs-mana-bar-wrap">
          <div class="cs-mana-bar-track">
            <div class="cs-mana-bar-fill" style="width:${manaPct}%"></div>
          </div>
          <span class="cs-mana-text">🔮 ${mana} / ${maxMana} MP</span>
        </div>
        ${
          knownSpells.length > 0
            ? `<ul class="cs-spell-list">
            ${knownSpells
              .map((id) => {
                const sp = SPELLS[id];
                return `<li class="cs-spell-item">${sp?.icon ?? "✨"} ${sp?.name ?? id} <span class="cs-spell-cost">(${sp?.manaCost ?? "?"} MP)</span></li>`;
              })
              .join("")}
          </ul>`
            : '<p class="cs-empty">No spells known yet.</p>'
        }
      </section>`;
            })()
          : ""
      }

      <!-- Equipment slots -->
      <section class="cs-section">
        <h3 class="cs-section-title">⚔️ Equipment</h3>
        ${_renderEquipmentSlots(player)}
      </section>

    </div><!-- /.cs-body -->
  `;

  // Wire close button after innerHTML is set
  document
    .getElementById("btn-close-sheet")
    ?.addEventListener("click", closeCharacterSheet);
}

// ── Equipment Section Renderer ────────────────────────────────────────────────

function _renderEquipmentSlots(player) {
  const equip = player.equipment ?? {};

  // Sum all active bonuses for the summary row
  let totalAc = 0,
    totalAtk = 0,
    totalMana = 0,
    totalHp = 0;

  const slotRows = Object.entries(EQUIPMENT_SLOTS)
    .map(([slotKey, slotMeta]) => {
      const slotEntry = equip[slotKey];
      const template = slotEntry ? EQUIPMENT_TEMPLATES[slotEntry.itemId] : null;

      if (template) {
        totalAc += template.bonuses?.acBonus ?? 0;
        totalAtk += template.bonuses?.attackBonus ?? 0;
        totalMana += template.bonuses?.manaBonus ?? 0;
        totalHp += template.bonuses?.hpBonus ?? 0;
      }

      const filled = !!template;
      return `
        <div class="cs-slot-row ${filled ? "cs-slot-row--filled" : "cs-slot-row--empty"}">
          <span class="cs-slot-icon">${slotMeta.icon}</span>
          <div class="cs-slot-body">
            <span class="cs-slot-label">${slotMeta.label}</span>
            ${
              filled
                ? `<span class="cs-slot-name">${template.icon} ${template.name}</span>
                 <span class="cs-slot-bonus-line">${template.description}</span>`
                : `<span class="cs-slot-empty-text">— empty —</span>`
            }
          </div>
        </div>`;
    })
    .join("");

  // Build a compact summary of all active deltas
  const parts = [];
  if (totalAtk) parts.push(`⚔️ +${totalAtk} ATK`);
  if (totalAc) parts.push(`🛡️ +${totalAc} AC`);
  if (totalHp) parts.push(`❤️ +${totalHp} Max HP`);
  if (totalMana) parts.push(`🔮 +${totalMana} Max MP`);

  const summary = parts.length
    ? `<div class="cs-equip-summary">${parts.join(" · ")}</div>`
    : "";

  return `
    <div class="cs-equip-slots">${slotRows}</div>
    ${summary}
  `;
}
