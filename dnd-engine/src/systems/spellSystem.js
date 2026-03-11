/**
 * spellSystem.js — Mana management and spell casting logic.
 *
 * PUBLIC API
 * ──────────────────────────────────────────────────────────────────
 *  initMana()               Set up mana for the current player class.
 *                           Safe to call at any time; no-ops if mana
 *                           is already correctly configured.
 *
 *  castSpell(id, targetId)  Validate, deduct MP, resolve effect, log.
 *                           Returns { ok: true } or { ok: false, reason }.
 *                           Does NOT call advanceTurn — caller decides.
 *
 * EVENTS EMITTED
 * ──────────────────────────────────────────────────────────────────
 *  SPELL_CAST    { spellId, spellName, caster, result }
 *  MANA_CHANGED  { mana, maxMana }
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { roll } from "./diceSystem.js";
import { applyDamage, logCombatAction } from "./turnManager.js";
import { SPELLS, CLASS_MANA, CLASS_SPELLS } from "../data/spells.js";
import { playSFX } from "./audioSystem.js";

// ── Mana Initialization ───────────────────────────────────────────────────────

/**
 * Configure mana and known spells for the player's class.
 * Call once after character creation and after loading a save.
 * If the player already has maxMana set (loaded save with mana data),
 * this is a no-op so we never overwrite a saved value.
 */
export function initMana() {
  const state = gameStore.getState();
  const { player } = state;
  const cls = player.class;

  // Always wire mana regen/buff-cleanup listeners (idempotent guard inside)
  _wireManaRegen();

  // Already initialised (fresh or loaded from save)
  if ((player.maxMana ?? 0) > 0) return;

  const maxMana = CLASS_MANA[cls] ?? 0;
  const knownSpells = CLASS_SPELLS[cls] ?? [];

  if (maxMana === 0 && knownSpells.length === 0) return; // Non-caster with no abilities

  gameStore.setState(
    { player: { ...player, mana: maxMana, maxMana, knownSpells } },
    "spellSystem:initMana",
  );

  console.log(
    `[SpellSystem] ${player.name} (${cls}) — ${maxMana} MP, spells: [${knownSpells.join(", ")}]`,
  );
}

// ── Spell Casting ─────────────────────────────────────────────────────────────

/**
 * Cast a spell by ID.
 *
 * @param {string} spellId
 * @param {string | null} targetId - Combat participant id (required for damage spells)
 * @returns {{ ok: boolean, reason?: string, result?: string }}
 */
export async function castSpell(spellId, targetId) {
  const state = gameStore.getState();
  const player = state.player;
  const spell = SPELLS[spellId];

  // ── Guards ──────────────────────────────────────────────────────────────
  if (!spell) {
    return { ok: false, reason: `Unknown spell "${spellId}"` };
  }
  if ((player.mana ?? 0) < spell.manaCost) {
    return {
      ok: false,
      reason: `Not enough mana (need ${spell.manaCost}, have ${player.mana ?? 0})`,
    };
  }
  if (spell.requiresTarget && !targetId) {
    return { ok: false, reason: "No target selected" };
  }

  // ── Deduct mana ─────────────────────────────────────────────────────────
  const newMana = (player.mana ?? 0) - spell.manaCost;
  gameStore.setState(
    { player: { ...player, mana: newMana } },
    "spellSystem:castSpell",
  );
  eventBus.emit(EVENTS.MANA_CHANGED, {
    mana: newMana,
    maxMana: player.maxMana,
  });

  // ── Resolve effect ───────────────────────────────────────────────────────
  let logResult;

  switch (spell.type) {
    case "damage": {
      const dmgRoll = roll(spell.effect.notation);
      const statMod = spell.effect.stat
        ? Math.floor(((player.abilities[spell.effect.stat] ?? 10) - 10) / 2)
        : 0;
      const baseDmg = Math.max(1, dmgRoll.total + statMod);

      if (spell.aoe) {
        // ─ AOE spell: hit every living enemy ──────────────────────────────
        const enemies = gameStore
          .getState()
          .combat.turnOrder.filter((p) => !p.isPlayer && (p.hp ?? 0) > 0);
        const profBonus = player.proficiencyBonus ?? 2;
        const spellMod = spell.effect.stat
          ? Math.floor(((player.abilities[spell.effect.stat] ?? 10) - 10) / 2)
          : 0;
        const saveDC = spell.savingThrow ? 8 + profBonus + spellMod : 0;

        let totalHits = 0;
        for (const enemy of enemies) {
          let finalDmg = baseDmg;
          if (spell.savingThrow) {
            const saveBonus = enemy.saveBonus ?? 0;
            const saveRoll = roll(`1d20+${saveBonus}`).total;
            const saved = saveRoll >= saveDC;
            if (saved && spell.savingThrow.halfOnSuccess) {
              finalDmg = Math.max(1, Math.floor(baseDmg / 2));
            }
            const saveDesc = saved
              ? `saved (${saveRoll} ≥ DC${saveDC})`
              : `failed (${saveRoll} < DC${saveDC})`;
            logCombatAction({
              actor: player.name,
              action: `${spell.icon} ${spell.name} → ${enemy.name}`,
              result: `${finalDmg} dmg, ${saveDesc}`,
            });
          }
          applyDamage(enemy.id, finalDmg);
          totalHits += finalDmg;
        }
        logResult = `${spell.icon} hits all enemies (${enemies.length}), avg ${enemies.length ? Math.round(totalHits / enemies.length) : 0} dmg each`;
        eventBus.emit(EVENTS.COMBAT_HIT, {
          attackerId: player.id ?? "player",
          targetId: null,
          damage: totalHits,
          source: spell.name,
        });
      } else {
        // ─ Single-target spell ─────────────────────────────────────
        applyDamage(targetId, baseDmg);
        logResult = `${baseDmg} damage [${spell.effect.notation}=${dmgRoll.total}${statMod >= 0 ? "+" : ""}${statMod} ${spell.effect.stat?.toUpperCase() ?? ""}]`;

        // Apply optional status effect
        if (spell.statusEffect && targetId) {
          const st = gameStore.getState();
          const tidx = st.combat.turnOrder.findIndex((p) => p.id === targetId);
          if (tidx >= 0) {
            const eff = spell.statusEffect;
            const existing = st.combat.turnOrder[tidx].activeEffects ?? [];
            const newOrder = st.combat.turnOrder.map((p, i) =>
              i === tidx
                ? {
                    ...p,
                    activeEffects: [
                      ...existing.filter((e) => e.id !== eff.id),
                      eff,
                    ],
                  }
                : p,
            );
            gameStore.setState(
              { combat: { ...st.combat, turnOrder: newOrder } },
              "spellSystem:statusEffect",
            );
            logResult += ` + ${eff.id} (${eff.duration} turns)`;
          }
        }

        eventBus.emit(EVENTS.COMBAT_HIT, {
          attackerId: player.id ?? "player",
          targetId,
          damage: baseDmg,
          source: spell.name,
        });
      }
      break;
    }

    case "heal": {
      const healRoll = roll(spell.effect.notation);
      const statMod = spell.effect.stat
        ? Math.floor(((player.abilities[spell.effect.stat] ?? 10) - 10) / 2)
        : 0;
      const healAmt = Math.max(1, healRoll.total + statMod);

      if (spell.aoe) {
        // AOE heal: affects all living party members (player + any allies)
        // In single-player this is just the player, but structured for future party support
        const freshPlayer = gameStore.getState().player;
        const newHp = Math.min(freshPlayer.maxHp, freshPlayer.hp + healAmt);
        const combatState = gameStore.getState().combat;
        const toPatch = combatState.active
          ? {
              combat: {
                ...combatState,
                turnOrder: combatState.turnOrder.map((p) =>
                  p.isPlayer ? { ...p, hp: newHp } : p,
                ),
              },
            }
          : {};
        gameStore.setState(
          { player: { ...freshPlayer, hp: newHp }, ...toPatch },
          "spellSystem:aoeHeal",
        );
        logResult = `${spell.icon} restores ${healAmt} HP to all allies (${freshPlayer.hp} \u2192 ${newHp})`;
        break;
      }

      // Re-read player (damage might have happened mid-async)
      const freshPlayer = gameStore.getState().player;
      const oldHp = freshPlayer.hp;
      const newHp = Math.min(freshPlayer.maxHp, freshPlayer.hp + healAmt);

      // Sync into combat.turnOrder so the HP bar stays accurate during combat
      const combatHeal = gameStore.getState().combat;
      const turnOrderHealPatch = combatHeal.active
        ? {
            combat: {
              ...combatHeal,
              turnOrder: combatHeal.turnOrder.map((p) =>
                p.isPlayer ? { ...p, hp: newHp } : p,
              ),
            },
          }
        : {};

      gameStore.setState(
        { player: { ...freshPlayer, hp: newHp }, ...turnOrderHealPatch },
        "spellSystem:heal",
      );
      logResult = `restores ${healAmt} HP (${oldHp} → ${newHp})`;
      break;
    }

    case "buff": {
      const freshPlayer = gameStore.getState().player;
      const acBonus = spell.effect.acBonus ?? 0;
      const newAc = acBonus > 0 ? freshPlayer.ac + acBonus : freshPlayer.ac;

      // Sync AC into combat.turnOrder so enemy attack rolls use the updated value
      const combatBuff = gameStore.getState().combat;
      const turnOrderBuffPatch =
        combatBuff.active && acBonus > 0
          ? {
              combat: {
                ...combatBuff,
                turnOrder: combatBuff.turnOrder.map((p) =>
                  p.isPlayer ? { ...p, ac: newAc } : p,
                ),
              },
            }
          : {};

      if (acBonus > 0) {
        _combatAcBuff += acBonus; // remember so we can strip it on COMBAT_ENDED
        _lastConcAcBonus = acBonus; // remember for mid-combat concentration break
      }

      // Bless: log the +1d4 benefit and wire attack bonus per round
      const blessAttackDie = spell.effect.attackBlessingDie ?? 0;
      if (blessAttackDie > 0) {
        const blessBonus = roll(`1d${blessAttackDie}`).total;
        _lastConcAtkBonus = blessBonus;
        logResult = `Bless! +${blessBonus} to your next attack roll this round`;
        // Bless temporarily adds to player.attackBonus (stripped on COMBAT_ENDED via concentration clear)
        const blessPlayer = gameStore.getState().player;
        gameStore.setState(
          {
            player: {
              ...blessPlayer,
              attackBonus: (blessPlayer.attackBonus ?? 0) + blessBonus,
            },
            ...turnOrderBuffPatch,
          },
          "spellSystem:bless",
        );
      } else {
        _lastConcAtkBonus = 0;
        gameStore.setState(
          { player: { ...freshPlayer, ac: newAc }, ...turnOrderBuffPatch },
          "spellSystem:buff",
        );
        logResult = `+${acBonus} AC until end of combat`;
      }
      break;
    }

    default:
      logResult = "effect applied";
  }

  // ── Log & emit ───────────────────────────────────────────────────────────
  logCombatAction({
    actor: player.name,
    action: `casts ${spell.icon} ${spell.name}`,
    result: logResult,
  });

  eventBus.emit(EVENTS.SPELL_CAST, {
    spellId,
    spellName: spell.name,
    caster: player.name,
    result: logResult,
  });
  playSFX(spell.type === "heal" ? "spell_heal" : "spell");

  // ── Concentration ————————————————————————————————————————————————
  if (spell.concentration) {
    const cPlayer = gameStore.getState().player;
    if (cPlayer.concentration && cPlayer.concentration.spellId !== spellId) {
      // Break old concentration before setting the new one
      const prev = cPlayer.concentration;
      logCombatAction({
        actor: cPlayer.name,
        action: "breaks Concentration",
        result: `${prev.spellName} fades as you concentrate on ${spell.name}`,
      });
      eventBus.emit(EVENTS.CONCENTRATION_BROKEN, {
        spellId: prev.spellId,
        spellName: prev.spellName,
        // Pass bonus data so the listener can reverse AC / attack bonuses correctly
        appliedAcBonus: prev.appliedAcBonus ?? 0,
        appliedAttackBonus: prev.appliedAttackBonus ?? 0,
      });
    }
    const cPlayer2 = gameStore.getState().player;
    gameStore.setState(
      {
        player: {
          ...cPlayer2,
          concentration: {
            spellId,
            spellName: spell.name,
            appliedAcBonus: _lastConcAcBonus,
            appliedAttackBonus: _lastConcAtkBonus,
          },
        },
      },
      "spellSystem:setConcentration",
    );
    // Reset pending bonuses
    _lastConcAcBonus = 0;
    _lastConcAtkBonus = 0;
  }

  return { ok: true, result: logResult };
}

// ── Internal: Buff Tracking ──────────────────────────────────────────────────
// Tracks the total AC bonus granted by buff spells in the current combat so
// we can reverse it when combat ends (prevents per-combat stacking).
let _combatAcBuff = 0;

// Tracks bonuses from the most-recently-cast concentration buff so we can
// reverse them exactly when concentration is broken mid-combat.
let _lastConcAcBonus = 0;
let _lastConcAtkBonus = 0;

// ── Internal: Mana Regen ──────────────────────────────────────────────────────

let _regenWired = false;

function _wireManaRegen() {
  if (_regenWired) return;
  _regenWired = true;

  // Reset buff-tracking vars at the start of every new combat so values from
  // a previous encounter never corrupt AC or attack bonus in the next one.
  eventBus.on(EVENTS.COMBAT_STARTED, () => {
    _combatAcBuff = 0;
    _lastConcAcBonus = 0;
    _lastConcAtkBonus = 0;
  });

  // Mana regen per round: full casters = 1 MP, half casters = 1 MP, non-casters = 0
  const _FULL_CASTERS = new Set([
    "Wizard",
    "Sorcerer",
    "Cleric",
    "Druid",
    "Bard",
    "Warlock",
  ]);
  const _HALF_CASTERS = new Set(["Paladin", "Ranger", "Monk"]);

  eventBus.on(EVENTS.COMBAT_TURN_START, ({ current }) => {
    if (!current?.isPlayer) return;

    const p = gameStore.getState().player;
    if (!p.maxMana) return;

    const playerClass = p.class ?? "";
    const regenAmt =
      _FULL_CASTERS.has(playerClass) || _HALF_CASTERS.has(playerClass) ? 1 : 0;
    if (regenAmt === 0) return;

    const newMana = Math.min(p.maxMana, (p.mana ?? 0) + regenAmt);
    if (newMana === p.mana) return;

    gameStore.setState(
      { player: { ...p, mana: newMana } },
      "spellSystem:manaRegen",
    );
    eventBus.emit(EVENTS.MANA_CHANGED, { mana: newMana, maxMana: p.maxMana });
  });

  // On combat end, strip any AC buffs granted during this combat
  eventBus.on(EVENTS.COMBAT_ENDED, () => {
    if (_combatAcBuff === 0) return;
    const p = gameStore.getState().player;
    const restoredAc = p.ac - _combatAcBuff;
    _combatAcBuff = 0;
    gameStore.setState(
      { player: { ...p, ac: restoredAc } },
      "spellSystem:removeCombatBuffs",
    );
    console.log(
      `[SpellSystem] Combat over — removed ${restoredAc < p.ac ? p.ac - restoredAc : 0} buffed AC, restored to ${restoredAc}`,
    );
  });

  // When concentration is broken mid-combat, reverse the AC/attack bonuses
  eventBus.on(EVENTS.CONCENTRATION_BROKEN, (evt) => {
    const p = gameStore.getState().player;
    // concentration is already null in the store at this point — read bonus data
    // from the event payload (passed by turnManager before clearing the store).
    const acToRemove = evt?.appliedAcBonus ?? 0;
    const atkToRemove = evt?.appliedAttackBonus ?? 0;
    if (acToRemove > 0) {
      _combatAcBuff = Math.max(0, _combatAcBuff - acToRemove);
    }
    const newAc = acToRemove > 0 ? p.ac - acToRemove : p.ac;
    const newAtk =
      atkToRemove > 0
        ? Math.max(0, (p.attackBonus ?? 0) - atkToRemove)
        : (p.attackBonus ?? 0);
    if (acToRemove > 0 || atkToRemove > 0) {
      gameStore.setState(
        { player: { ...p, ac: newAc, attackBonus: newAtk } },
        "spellSystem:concentrationBrokenReverse",
      );
      console.log(
        `[SpellSystem] Concentration broken — reversed ${acToRemove} AC, ${atkToRemove} ATK bonus`,
      );
    }
  });

  // On combat end, clear any active concentration spell
  eventBus.on(EVENTS.COMBAT_ENDED, () => {
    const p2 = gameStore.getState().player;
    if (!p2.concentration) return;
    const ca = p2.classAbilities ?? {};
    // Also clear Hunter's Mark if concentration ended
    const caPatch = ca.hunterMarkTarget
      ? { ...ca, hunterMarkTarget: null }
      : ca;
    gameStore.setState(
      { player: { ...p2, concentration: null, classAbilities: caPatch } },
      "spellSystem:clearConcentrationOnCombatEnd",
    );
  });
}
