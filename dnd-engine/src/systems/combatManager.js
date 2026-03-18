/**
 * combatManager.js — Deterministic tactical enemy AI.
 *
 * Handles enemy turns locally (move toward player, then attack if in range).
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import {
  moveParticipant,
  calcDistance,
  advanceTurn,
  endCombat,
  logCombatAction,
  applyDamage,
  applyStatusEffect,
  handlePlayerKnockout,
} from "./turnManager.js";
import { resolveAttackDamageAsync } from "./combatDamagePipeline.js";
import { roll } from "./diceSystem.js";

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Execute one full enemy AI turn: think → move → attack/pass.
 *
 * @param {import('./turnManager.js').CombatParticipant} enemy  The active enemy (from turn order)
 * @param {number} [thinkMs=800]  Pre-action delay so the turn doesn't resolve instantly
 */
export async function runAITurn(enemy, thinkMs = 800) {
  const state = gameStore.getState();
  if (!state.combat.active) return;

  await new Promise((resolve) => setTimeout(resolve, thinkMs));
  if (!gameStore.getState().combat.active) return;

  const turnOrder = gameStore.getState().combat.turnOrder;
  const live = turnOrder.filter((participant) => (participant.hp ?? 0) > 0);
  const enemyNow = live.find((participant) => participant.id === enemy.id);
  const player =
    live.find((participant) => participant.isPlayer) ??
    turnOrder.find((participant) => participant.isPlayer);

  if (!enemyNow || !player) {
    advanceTurn();
    return;
  }

  try {
    await _executeFallbackTurn(enemyNow, player);
  } catch (error) {
    console.error(
      "[CombatManager] Enemy turn crashed — forcing advanceTurn:",
      error,
    );
    advanceTurn();
  }
}

// ── Core combat resolution ───────────────────────────────────────────────────

/**
 * Roll and apply one attack: to-hit, damage, advance turn.
 * Player state is read fresh from the store to ensure up-to-date HP/AC.
 *
 * @param {object} enemy
 */
async function _resolveAttack(enemy) {
  const state = gameStore.getState();
  const latestPlayer = state.player;

  if (latestPlayer.deathSaveActive) {
    const saves = {
      successes: latestPlayer.deathSaves?.successes ?? 0,
      failures: Math.min(3, (latestPlayer.deathSaves?.failures ?? 0) + 2),
    };
    gameStore.setState(
      { player: { ...latestPlayer, deathSaves: saves } },
      "combatManager:attackWhileUnconscious",
    );
    logCombatAction({
      actor: enemy.name,
      action: "strikes the unconscious player (auto-crit!)",
      result: `2 death save failures (${saves.failures}/3)`,
    });

    const overlay = document.querySelector("#death-save-overlay");
    if (overlay) {
      overlay.querySelectorAll("#ds-failures .ds-pip").forEach((pip, index) => {
        pip.classList.toggle("ds-pip--filled", index < saves.failures);
      });
      const resultEl = overlay.querySelector("#ds-result");
      if (resultEl) {
        resultEl.textContent = `${enemy.name} strikes! 2 death save failures.`;
      }
    }

    if (saves.failures >= 3) {
      const dsBtn = document.querySelector("#ds-roll-btn");
      if (dsBtn) dsBtn.remove();
      const title = overlay?.querySelector(".ds-title");
      if (title) title.textContent = "💀 YOUR CHARACTER HAS DIED";
      await new Promise((resolve) => setTimeout(resolve, 1800));
      overlay?.remove();
      endCombat();
      return;
    }

    advanceTurn();
    return;
  }

  const enemyCombatant = state.combat.turnOrder.find(
    (participant) => participant.id === enemy.id,
  );
  const enemyEffects = enemyCombatant?.activeEffects ?? [];
  const enemyDisadv = enemyEffects.some(
    (effect) =>
      effect.id === "frightened" ||
      effect.id === "blinded" ||
      effect.id === "prone",
  );
  const playerDodging = latestPlayer.dodging ?? false;

  const playerCombatant = state.combat.turnOrder.find(
    (participant) => participant.isPlayer,
  );
  const playerEffects = playerCombatant?.activeEffects ?? [];
  const enemyHasAdv = playerEffects.some(
    (effect) => effect.id === "blinded" || effect.id === "prone",
  );

  const hasDisadv = (enemyDisadv || playerDodging) && !enemyHasAdv;
  const hasAdv = enemyHasAdv && !enemyDisadv && !playerDodging;

  const attackBonus = enemy.attackBonus ?? 0;
  const atkBonusStr = attackBonus >= 0 ? `+${attackBonus}` : `${attackBonus}`;
  const atkNotation = hasDisadv
    ? `2d20kl1${atkBonusStr}`
    : hasAdv
      ? `2d20kh1${atkBonusStr}`
      : attackBonus >= 0
        ? `1d20+${attackBonus}`
        : `1d20-${Math.abs(attackBonus)}`;

  const attackRoll = roll(atkNotation);

  if (hasDisadv || hasAdv) {
    const cause = hasAdv
      ? playerEffects.find(
          (effect) => effect.id === "blinded" || effect.id === "prone",
        )?.id
      : (enemyEffects.find(
          (effect) =>
            effect.id === "frightened" ||
            effect.id === "blinded" ||
            effect.id === "prone",
        )?.id ?? "player dodging");

    logCombatAction({
      actor: enemy.name,
      action: `attacks at ${hasAdv ? "Advantage" : "Disadvantage"}`,
      result: `Cause: ${cause}`,
    });
  }

  eventBus.emit(EVENTS.DICE_ANIMATE, {
    notation: atkNotation,
    result: attackRoll,
  });

  const usedDie = attackRoll.used?.[0] ?? attackRoll.dice[0];
  const hit = usedDie === 20 || attackRoll.total >= latestPlayer.ac;
  const crit = usedDie === 20;

  if (!hit) {
    logCombatAction({
      actor: enemy.name,
      action: "attacks you",
      result: `Miss (rolled ${attackRoll.total} vs your AC ${latestPlayer.ac})`,
    });
    eventBus.emit(EVENTS.COMBAT_MISS, { attacker: enemy.name });
    advanceTurn();
    return;
  }

  const baseDmgNotation = enemy.damageDie ?? "1d6";
  const critDmgNotation = baseDmgNotation.replace(
    /^(\d+)d(\d+)/,
    (_, count, die) => `${parseInt(count, 10) * 2}d${die}`,
  );
  const dmgNotation = crit ? critDmgNotation : baseDmgNotation;
  const dmgRoll = roll(dmgNotation);

  eventBus.emit(EVENTS.DICE_ANIMATE, {
    notation: dmgNotation,
    result: dmgRoll,
  });

  const bonus = enemy.baseDmg ?? 0;
  const totalDmg = dmgRoll.total + bonus;

  const resolvedDamage = await resolveAttackDamageAsync(
    {
      targetId: latestPlayer.id ?? "player",
      targetIsPlayer: true,
      amount: totalDmg,
      isCritical: crit,
      damageType: enemy.damageType ?? "physical",
      extraReduction: 0,
    },
    {},
  );
  const finalDamage = resolvedDamage.amount;

  applyDamage(latestPlayer.id ?? "player", finalDamage, {
    isCrit: crit,
    damageType: enemy.damageType ?? "physical",
    useDamagePipeline: false,
  });

  if (enemy.onHit && Math.random() < (enemy.onHit.chance ?? 0)) {
    const playerId = latestPlayer.id ?? "player";
    const effect = {
      id: (enemy.onHit.status ?? "poison").toLowerCase(),
      duration: enemy.onHit.duration ?? 2,
    };

    applyStatusEffect(playerId, effect);
    logCombatAction({
      actor: enemy.name,
      action: "applies",
      result: `${enemy.onHit.status}! (${effect.duration} turns)`,
    });
  }

  const newHp = gameStore.getState().player.hp;

  eventBus.emit(EVENTS.PLAYER_DAMAGED, {
    damage: finalDamage,
    newHp,
    source: enemy.name,
    crit,
  });

  logCombatAction({
    actor: enemy.name,
    action: `attacks you${crit ? " (CRIT!)" : ""}`,
    result: `Hit for ${finalDamage} damage — you have ${newHp}/${latestPlayer.maxHp} HP remaining`,
  });

  if (newHp === 0) {
    handlePlayerKnockout();
    return;
  }

  advanceTurn();
}

/**
 * Deterministic enemy turn — simple move-toward + attack.
 *
 * @param {object} enemy
 * @param {object} player
 */
async function _executeFallbackTurn(enemy, player) {
  const weaponRange = enemy.weaponRange ?? 1;
  const initialTurnOrder = gameStore.getState().combat.turnOrder;
  const initialPlayer =
    initialTurnOrder.find((participant) => participant.isPlayer) ?? player;

  let dist = calcDistance(enemy, initialPlayer);
  let updated = null;

  if (dist > weaponRange) {
    _nudgeTowardPlayer(enemy, player);

    const turnOrder = gameStore.getState().combat.turnOrder;
    updated =
      turnOrder.find((participant) => participant.id === enemy.id) ?? null;
    const updatedPlayer =
      turnOrder.find((participant) => participant.isPlayer) ?? player;

    if (updated) {
      dist = calcDistance(updated, updatedPlayer);
    }
  }

  if (dist > weaponRange) {
    logCombatAction({
      actor: enemy.name,
      action: "moves toward you",
      result: "Out of reach — unable to attack this turn.",
    });
    advanceTurn();
    return;
  }

  await _resolveAttack(updated ?? enemy);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Move one enemy one diagonal step toward the target (respects budget).
 *
 * @param {object} enemy
 * @param {object} target
 */
function _nudgeTowardPlayer(enemy, target) {
  const { cols = 20, rows = 14 } = gameStore.getState().combat.map ?? {};
  const moveSq = Math.floor((enemy.movementRemaining ?? 0) / 5);
  if (moveSq === 0) return;

  const turnOrder = gameStore.getState().combat.turnOrder;
  const liveTarget =
    turnOrder.find((participant) => participant.id === target.id) ??
    turnOrder.find((participant) => participant.isPlayer) ??
    target;

  const weaponRange = enemy.weaponRange ?? 1;
  const dist = calcDistance(enemy, liveTarget);
  if (dist <= weaponRange) return;

  const steps = Math.min(moveSq, dist - weaponRange);
  const dx = Math.sign(liveTarget.x - enemy.x);
  const dy = Math.sign(liveTarget.y - enemy.y);
  const tx = Math.max(0, Math.min(cols - 1, enemy.x + dx * steps));
  const ty = Math.max(0, Math.min(rows - 1, enemy.y + dy * steps));

  if (tx === enemy.x && ty === enemy.y) return;

  const result = moveParticipant(enemy.id, tx, ty);
  if (!result.ok) {
    for (const [fallbackX, fallbackY] of [
      [Math.max(0, Math.min(cols - 1, enemy.x + dx * steps)), enemy.y],
      [enemy.x, Math.max(0, Math.min(rows - 1, enemy.y + dy * steps))],
    ]) {
      if (fallbackX === enemy.x && fallbackY === enemy.y) continue;
      if (moveParticipant(enemy.id, fallbackX, fallbackY).ok) break;
    }
  }
}
