/**
 * restSystem.js — Short Rest and Long Rest mechanics.
 *
 * SHORT REST (1 hour)
 *   - Roll hit dice (1d per player level, using class hit die)
 *   - Restore rolled HP (up to maxHp)
 *   - Restore 40% of maxMana
 *   - Does NOT restore spell slots in classic 5e, but we use mana so partial restore
 *
 * LONG REST (8 hours)
 *   - Full HP restore
 *   - Full mana restore
 *   - Clears exhaustion conditions
 *
 * EVENTS EMITTED
 * ──────────────────────────────────────────────────────────────────
 *  REST_COMPLETED  { restType, hpRestored, manaRestored, newHp, newMana }
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { roll } from "./diceSystem.js";

// Hit die per class (standard 5e)
const CLASS_HIT_DIE = {
  Barbarian: "d12",
  Fighter: "d10",
  Paladin: "d10",
  Ranger: "d10",
  Bard: "d8",
  Cleric: "d8",
  Druid: "d8",
  Monk: "d8",
  Rogue: "d8",
  Warlock: "d8",
  Sorcerer: "d6",
  Wizard: "d6",
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Short Rest: roll hit dice, restore partial HP + 40% mana.
 * @returns {{ hpRestored: number, manaRestored: number, newHp: number, newMana: number }}
 */
export function shortRest() {
  const p = gameStore.getState().player;
  const level = p.level ?? 1;
  const hitDie = CLASS_HIT_DIE[p.class] ?? "d8";
  const notation = `${level}${hitDie}`;

  const healRoll = roll(notation);
  const conMod = Math.floor(((p.abilities?.con ?? 10) - 10) / 2);
  const hpRestored = Math.max(1, healRoll.total + conMod * level);

  const newHp = Math.min(p.maxHp, (p.hp ?? 0) + hpRestored);
  const actualHpRestored = newHp - (p.hp ?? 0);

  // Restore 40% mana (rounded up)
  const maxMana = p.maxMana ?? 0;
  const manaRestored = maxMana > 0 ? Math.ceil(maxMana * 0.4) : 0;
  const newMana = Math.min(maxMana, (p.mana ?? 0) + manaRestored);
  const actualManaRestored = newMana - (p.mana ?? 0);

  // Short rest resets per-short-rest class abilities
  const caShort = { ...(p.classAbilities ?? {}) };
  caShort.secondWindUsed = false;
  caShort.bardInspirationUsed = false;
  caShort.reactionAvailable = true;
  caShort.extraAttackUsedThisTurn = false;
  caShort.kiPoints = caShort.maxKiPoints ?? 0;

  gameStore.setState(
    { player: { ...p, hp: newHp, mana: newMana, classAbilities: caShort } },
    "restSystem:shortRest",
  );

  eventBus.emit(EVENTS.REST_COMPLETED, {
    restType: "short",
    hpRestored: actualHpRestored,
    manaRestored: actualManaRestored,
    newHp,
    newMana,
    roll: `${notation} = ${healRoll.total}${conMod !== 0 ? `${conMod > 0 ? "+" : ""}${conMod * level} CON` : ""}`,
  });

  if (maxMana > 0) {
    eventBus.emit(EVENTS.MANA_CHANGED, { mana: newMana, maxMana });
  }

  console.log(
    `[RestSystem] Short rest — +${actualHpRestored} HP (${p.hp} → ${newHp}), +${actualManaRestored} MP (${p.mana} → ${newMana})`,
  );

  return {
    hpRestored: actualHpRestored,
    manaRestored: actualManaRestored,
    newHp,
    newMana,
  };
}

/**
 * Long Rest: full HP + full mana restore. Clears exhaustion.
 * @returns {{ hpRestored: number, manaRestored: number, newHp: number, newMana: number }}
 */
export function longRest() {
  const p = gameStore.getState().player;

  const newHp = p.maxHp;
  const newMana = p.maxMana ?? 0;
  const hpRestored = newHp - (p.hp ?? 0);
  const manaRestored = newMana - (p.mana ?? 0);

  // Clear exhaustion condition if present
  const conditions = (p.conditions ?? []).filter(
    (c) => c !== "exhaustion" && c !== "exhausted",
  );

  // Long rest resets ALL class ability resources
  const caLong = { ...(p.classAbilities ?? {}) };
  caLong.secondWindUsed = false;
  caLong.bardInspirationUsed = false;
  caLong.rageActive = false;
  caLong.rageRoundsLeft = 0;
  caLong.rageUses = caLong.maxRageUses ?? 2;
  caLong.kiPoints = caLong.maxKiPoints ?? 0;
  caLong.smitePending = false;
  caLong.hunterMarkTarget = null;
  caLong.bardBonusDie = 0;
  caLong.reactionAvailable = true;
  caLong.extraAttackUsedThisTurn = false;
  // Lucky feat: 3 reroll tokens reset on long rest (D&D 5e rule)
  if ((p.feats ?? []).includes("lucky")) {
    caLong.luckPoints = 3;
  }

  gameStore.setState(
    {
      player: {
        ...p,
        hp: newHp,
        mana: newMana,
        conditions,
        classAbilities: caLong,
        // Write luckPoints to player root (where the store and feat system expect it)
        ...(caLong.luckPoints != null ? { luckPoints: caLong.luckPoints } : {}),
      },
    },
    "restSystem:longRest",
  );

  eventBus.emit(EVENTS.REST_COMPLETED, {
    restType: "long",
    hpRestored,
    manaRestored,
    newHp,
    newMana,
  });

  if (newMana > 0) {
    eventBus.emit(EVENTS.MANA_CHANGED, { mana: newMana, maxMana: newMana });
  }

  console.log(
    `[RestSystem] Long rest — fully restored (HP: ${newHp}/${newHp}, MP: ${newMana}/${newMana})`,
  );

  return { hpRestored, manaRestored, newHp, newMana };
}
