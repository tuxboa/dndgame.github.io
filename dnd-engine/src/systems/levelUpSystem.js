/**
 * levelUpSystem.js — XP tracking and level-up logic.
 *
 * PUBLIC API
 * ──────────────────────────────────────────────────────────────────
 *  addXp(amount)
 *    Add XP to the player. Emits LEVEL_UP_READY with full preview
 *    data when the threshold (level × 100) is reached.
 *
 *  applyLevelUp(choice)
 *    'str'|'dex'|'con'|'int'|'wis'|'cha'  — +1 to that ability
 *    'feat:<id>'                            — apply feat from FEATS
 *
 *    Automatically:
 *      • Increments player.level
 *      • +5 Max HP, +2 Max MP, full heal/mana restore
 *      • Updates proficiencyBonus (D&D 5e progression)
 *      • Applies class-level bonuses (rage uses, ki points, spells, …)
 *      • Unlocks spells from CLASS_LEVEL_SPELLS
 *      • Equipment bonus gap preserved
 *
 *  getProfBonus(level) — returns the D&D 5e proficiency bonus for a level
 *
 * EVENTS EMITTED
 * ──────────────────────────────────────────────────────────────────
 *  LEVEL_UP_READY  { newLevel, currentXp, threshold, playerClass,
 *                    classBonuses, newSpells, newProfBonus, oldProfBonus }
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { FEATS } from "../data/feats.js";
import { CLASS_LEVEL_SPELLS, SPELLS } from "../data/spells.js";

/** Progressive XP thresholds — exported so other modules (e.g. actionDispatcher) can use the same curve. */
export const XP_PER_LEVEL = [
  0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250, 3850, 4500, 5200,
  6000,
];

/** Average HP per level (hit die average) by class */
const CLASS_HP_PER_LEVEL = {
  Barbarian: 7,
  Fighter: 6,
  Paladin: 6,
  Ranger: 6,
  Monk: 5,
  Bard: 5,
  Cleric: 5,
  Druid: 5,
  Rogue: 5,
  Warlock: 5,
  Wizard: 4,
  Sorcerer: 4,
};
/** MP gained per level: full casters > half casters > non-casters */
const CLASS_MP_PER_LEVEL = {
  Wizard: 4,
  Sorcerer: 4,
  Cleric: 4,
  Druid: 4,
  Bard: 3,
  Warlock: 3,
  Paladin: 2,
  Ranger: 2,
  Monk: 1,
  Fighter: 0,
  Barbarian: 0,
  Rogue: 0,
};

// ── Proficiency bonus (D&D 5e) ────────────────────────────────────────────────
/** @param {number} level */
export function getProfBonus(level) {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

// ── Class-level bonus table ───────────────────────────────────────────────────
// Each entry: { desc: string, patchPlayer?: fn, patchCa?: fn }
const CLASS_LEVEL_BONUSES = {
  Barbarian: {
    3: [
      {
        desc: "Primal Path: +1 Rage use",
        patchCa: (ca) => ({
          ...ca,
          rageUses: (ca.rageUses ?? 2) + 1,
          maxRageUses: (ca.rageUses ?? 2) + 1,
        }),
      },
    ],
    5: [{ desc: "Extra Attack — make 2 attacks per turn" }],
    7: [{ desc: "Feral Instinct: +3 bonus to Initiative rolls" }],
    9: [
      {
        desc: "Brutal Critical: +1 extra damage die on crits",
        patchCa: (ca) => ({
          ...ca,
          rageUses: (ca.rageUses ?? 2) + 1,
          maxRageUses: (ca.rageUses ?? 2) + 1,
        }),
      },
    ],
  },
  Fighter: {
    5: [{ desc: "Extra Attack — make 2 attacks per turn" }],
    7: [{ desc: "Know Your Enemy: learn an enemy's statistics before combat" }],
    9: [
      {
        desc: "Indomitable: reroll one failed saving throw once per long rest",
      },
    ],
  },
  Paladin: {
    5: [{ desc: "Extra Attack — make 2 attacks per turn" }],
    7: [{ desc: "Aura of Protection: +CHA modifier to all saving throws" }],
    9: [{ desc: "Cleansing Touch: end a spell on an ally as an action" }],
  },
  Ranger: {
    5: [{ desc: "Extra Attack — make 2 attacks per turn" }],
    7: [{ desc: "Vanish: Hide as a bonus action in combat" }],
    9: [
      {
        desc: "Volley: make ranged attacks against every creature in a 10-ft radius",
      },
    ],
  },
  Monk: {
    2: [
      {
        desc: "Ki: 2 ki points — Flurry of Blows, Patient Defense, Step of the Wind",
        patchCa: (ca) => ({ ...ca, kiPoints: 2, maxKiPoints: 2 }),
      },
    ],
    3: [
      {
        desc: "+1 Ki point (total 3)",
        patchCa: (ca) => ({
          ...ca,
          kiPoints: (ca.kiPoints ?? 0) + 1,
          maxKiPoints: (ca.maxKiPoints ?? 0) + 1,
        }),
      },
    ],
    4: [
      {
        desc: "+1 Ki point (total 4)",
        patchCa: (ca) => ({
          ...ca,
          kiPoints: (ca.kiPoints ?? 0) + 1,
          maxKiPoints: (ca.maxKiPoints ?? 0) + 1,
        }),
      },
    ],
    5: [
      {
        desc: "Stunning Strike + Extra Attack",
        patchCa: (ca) => ({
          ...ca,
          kiPoints: (ca.kiPoints ?? 0) + 1,
          maxKiPoints: (ca.maxKiPoints ?? 0) + 1,
        }),
      },
    ],
    7: [{ desc: "Evasion: DEX save success = 0 damage, failure = half" }],
    9: [
      {
        desc: "Unarmored Movement improves: +5 ft. speed",
        patchCa: (ca) => ({
          ...ca,
          kiPoints: (ca.kiPoints ?? 0) + 1,
          maxKiPoints: (ca.maxKiPoints ?? 0) + 1,
        }),
      },
    ],
  },
  Rogue: {
    5: [
      {
        desc: "Uncanny Dodge: halve incoming damage once per round as a reaction",
      },
    ],
    7: [{ desc: "Evasion: DEX save success = 0 damage" }],
    9: [{ desc: "Supreme Sneak: Stealth advantage when moving at half speed" }],
  },
  Wizard: {
    5: [{ desc: "Arcane Recovery improves: recover more MP on short rest" }],
    7: [{ desc: "Spell Mastery: one 1st-level spell costs 0 MP" }],
    9: [
      {
        desc: "Signature Spells: two 3rd-level spells always prepared at no cost",
      },
    ],
  },
  Cleric: {
    5: [
      {
        desc: "Divine Strike: +1d8 radiant damage on one weapon attack per turn",
      },
    ],
    7: [
      {
        desc: "Divine Intervention: call upon your deity for miraculous aid (1×/long rest)",
      },
    ],
    9: [{ desc: "Improved Divine Strike: damage die increases to 2d8" }],
  },
  Druid: {
    5: [{ desc: "Improved Wild Shape: can transform into CR 1 beasts" }],
    7: [{ desc: "Timeless Body: no longer age and cannot be magically aged" }],
    9: [
      {
        desc: "Beast Spells: maintain concentration and cast while Wild Shaped",
      },
    ],
  },
  Bard: {
    5: [
      {
        desc: "Bardic Inspiration die improves to d8",
        patchCa: (ca) => ({ ...ca, bardBonusDie: 8 }),
      },
    ],
    7: [
      {
        desc: "Countercharm: end Charmed or Frightened on nearby allies as an action",
      },
    ],
    9: [
      {
        desc: "Magical Secrets: learn two spells from any class",
        // Emit a special event so LevelUpUI can show the spell-picker modal.
        // The two chosen spells are added in applyMagicalSecrets().
        patchCa: (ca) => ({ ...ca, magicalSecretsPending: 2 }),
      },
    ],
  },
  Sorcerer: {
    5: [
      {
        desc: "+2 Sorcery Points (Max MP)",
        patchPlayer: (p) => ({
          ...p,
          maxMana: (p.maxMana ?? 0) + 2,
          mana: (p.mana ?? 0) + 2,
          baseMaxMana: (p.baseMaxMana ?? p.maxMana ?? 0) + 2,
        }),
      },
    ],
    7: [
      {
        desc: "+2 Sorcery Points (Max MP)",
        patchPlayer: (p) => ({
          ...p,
          maxMana: (p.maxMana ?? 0) + 2,
          mana: (p.mana ?? 0) + 2,
          baseMaxMana: (p.baseMaxMana ?? p.maxMana ?? 0) + 2,
        }),
      },
    ],
    9: [
      {
        desc: "+2 Sorcery Points (Max MP)",
        patchPlayer: (p) => ({
          ...p,
          maxMana: (p.maxMana ?? 0) + 2,
          mana: (p.mana ?? 0) + 2,
          baseMaxMana: (p.baseMaxMana ?? p.maxMana ?? 0) + 2,
        }),
      },
    ],
  },
  Warlock: {
    5: [
      { desc: "Eldritch Invocation: Eldritch Blast deals +1d6 force damage" },
    ],
    7: [
      {
        desc: "Dark One's Own Luck: add 1d10 to one ability check (1×/short rest)",
      },
    ],
    9: [{ desc: "Mystic Arcanum: one free 6th-level spell per long rest" }],
  },
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function _getClassBonuses(cls, level) {
  return CLASS_LEVEL_BONUSES[cls]?.[level] ?? [];
}

function _getNewSpells(cls, level) {
  return CLASS_LEVEL_SPELLS[cls]?.[level] ?? [];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Award experience points. Triggers a level-up event when the
 * xp threshold (current level × 100) is reached or surpassed.
 * @param {number} amount
 */
export function addXp(amount) {
  if (!amount || amount <= 0) return;

  const state = gameStore.getState();
  const p = state.player;
  const newXp = (p.xp ?? 0) + amount;
  const level = p.level ?? 1;
  // Progressive XP curve — each level requires significantly more XP than the last
  const threshold =
    level < XP_PER_LEVEL.length ? XP_PER_LEVEL[level] : level * 300;

  gameStore.setState({ player: { ...p, xp: newXp } }, "levelUpSystem:addXp");

  console.log(
    `[LevelUpSystem] +${amount} XP → ${newXp}/${threshold} (Lv ${level})`,
  );

  if (newXp >= threshold) {
    const newLevel = level + 1;
    const classBonuses = _getClassBonuses(p.class, newLevel).map((b) => b.desc);
    const newSpells = _getNewSpells(p.class, newLevel).map(
      (id) => SPELLS[id]?.name ?? id,
    );
    const oldProfBonus = getProfBonus(level);
    const newProfBonus = getProfBonus(newLevel);

    eventBus.emit(EVENTS.LEVEL_UP_READY, {
      newLevel,
      currentXp: newXp,
      threshold,
      playerClass: p.class,
      classBonuses,
      newSpells,
      oldProfBonus,
      newProfBonus,
    });
  }
}

/**
 * Finalise a level-up after the player has made their choice.
 * @param {string} choice  stat key ('str'|'dex'|'con'|'int'|'wis'|'cha')
 *                         OR 'feat:<featId>' for a feat
 */
export function applyLevelUp(choice) {
  const isFeat = choice.startsWith("feat:");
  const featId = isFeat ? choice.slice(5) : null;

  const state = gameStore.getState();
  let p = { ...state.player };
  const newLevel = (p.level ?? 1) + 1;

  // ── Equipment bonus gap preservation ─────────────────────────────────────
  const baseHp = p.baseMaxHp ?? p.maxHp;
  const baseMp = p.baseMaxMana ?? p.maxMana ?? 0;
  const equipHpGap = p.baseMaxHp != null ? p.maxHp - p.baseMaxHp : 0;
  const equipMpGap =
    p.baseMaxMana != null ? (p.maxMana ?? 0) - p.baseMaxMana : 0;

  const hpGain = CLASS_HP_PER_LEVEL[p.class] ?? 5;
  const mpGain = CLASS_MP_PER_LEVEL[p.class] ?? 2;
  const newBaseMaxHp = baseHp + hpGain;
  const newBaseMaxMp = baseMp + mpGain;
  const newMaxHp = newBaseMaxHp + equipHpGap;
  const newMaxMp = newBaseMaxMp + equipMpGap;

  // ── Apply base level gains ────────────────────────────────────────────────
  p = {
    ...p,
    level: newLevel,
    maxHp: newMaxHp,
    baseMaxHp: newBaseMaxHp,
    hp: newMaxHp, // Full restore
    maxMana: newMaxMp,
    baseMaxMana: newBaseMaxMp,
    mana: newMaxMp, // Full restore
    proficiencyBonus: getProfBonus(newLevel),
  };

  // ── Ability score improvement ─────────────────────────────────────────────
  if (!isFeat) {
    p = {
      ...p,
      abilities: {
        ...p.abilities,
        [choice]: (p.abilities?.[choice] ?? 10) + 1,
      },
    };
  }

  // ── Feat ──────────────────────────────────────────────────────────────────
  if (isFeat && FEATS[featId]) {
    p = FEATS[featId].apply(p);
  }

  // ── Class-level bonuses ───────────────────────────────────────────────────
  const bonuses = _getClassBonuses(p.class, newLevel);
  let ca = { ...(p.classAbilities ?? {}) };
  for (const bonus of bonuses) {
    if (bonus.patchPlayer) p = bonus.patchPlayer(p);
    if (bonus.patchCa) ca = bonus.patchCa(ca);
  }
  p = { ...p, classAbilities: ca };

  // ── Spell unlocks ─────────────────────────────────────────────────────────
  const newSpellIds = _getNewSpells(p.class, newLevel);
  if (newSpellIds.length) {
    const existing = new Set(p.knownSpells ?? []);
    newSpellIds.forEach((id) => existing.add(id));
    p = { ...p, knownSpells: [...existing] };
  }

  gameStore.setState({ player: p }, "levelUpSystem:applyLevelUp");

  // ── Notification ──────────────────────────────────────────────────────────
  const choiceLabel = isFeat
    ? `Feat: ${FEATS[featId]?.name ?? featId}`
    : `+1 ${choice.toUpperCase()}`;
  const profNote =
    getProfBonus(newLevel) > getProfBonus(newLevel - 1)
      ? ` · Proficiency Bonus → +${getProfBonus(newLevel)}`
      : "";
  const spellNote = newSpellIds.length
    ? ` · New spells: ${newSpellIds.map((id) => SPELLS[id]?.name ?? id).join(", ")}`
    : "";

  eventBus.emit(EVENTS.UI_NOTIFICATION, {
    text: `⬆️ Level ${newLevel}! ${choiceLabel}, +${hpGain} Max HP${mpGain > 0 ? `, +${mpGain} Max MP` : ""}${profNote}${spellNote}`,
    type: "success",
    ttl: 7000,
  });

  console.log(
    `[LevelUpSystem] Lv ${newLevel} — ${choiceLabel}. ` +
      `HP ${state.player.maxHp}→${newMaxHp}, MP ${state.player.maxMana ?? 0}→${newMaxMp}, ` +
      `ProfBonus ${getProfBonus(newLevel)}${newSpellIds.length ? ", spells: " + newSpellIds.join(",") : ""}`,
  );

  // Magical Secrets: let the player pick 2 spells from any class.
  // Emit an event so LevelUpUI (or any listener) can show the picker UI.
  const freshP = gameStore.getState().player;
  if ((freshP.classAbilities?.magicalSecretsPending ?? 0) > 0) {
    const allSpellIds = Object.keys(SPELLS);
    eventBus.emit(EVENTS.MAGICAL_SECRETS_READY, {
      count: freshP.classAbilities.magicalSecretsPending,
      availableSpells: allSpellIds.map((id) => ({
        id,
        name: SPELLS[id]?.name ?? id,
        description: SPELLS[id]?.description ?? "",
      })),
    });
  }
}

/**
 * Add a spell chosen via Magical Secrets to the player's known spells.
 * Call this once per spell the player selects in the picker UI.
 * @param {string} spellId
 */
export function applyMagicalSecret(spellId) {
  const p = gameStore.getState().player;
  const ca = p.classAbilities ?? {};
  const pending = ca.magicalSecretsPending ?? 0;
  if (pending <= 0) return;

  const existing = new Set(p.knownSpells ?? []);
  existing.add(spellId);

  gameStore.setState(
    {
      player: {
        ...p,
        knownSpells: [...existing],
        classAbilities: {
          ...ca,
          magicalSecretsPending: Math.max(0, pending - 1),
        },
      },
    },
    "levelUpSystem:magicalSecret",
  );

  eventBus.emit(EVENTS.UI_NOTIFICATION, {
    text: `✨ Magical Secrets: learned ${SPELLS[spellId]?.name ?? spellId}!`,
    type: "success",
    ttl: 3000,
  });

  console.log(`[LevelUpSystem] Magical Secrets — added ${spellId}`);
}
