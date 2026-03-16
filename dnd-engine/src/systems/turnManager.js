/**
 * TurnManager
 *
 * Owns the turn lifecycle for strictly turn-based D&D combat.
 * Responsibilities:
 *   - Roll and sort initiative
 *   - Track whose turn it is
 *   - Advance turns and rounds
 *   - Enforce turn ownership (only active player/entity can act)
 *   - Emit EVENTS.COMBAT_TURN_START on each advance
 *
 * In co-op multiplayer:
 *   - isMyTurn is derived from session.currentTurnPlayerId === session.localPlayerId
 *   - The NetworkBridge will call advanceTurn() after server confirms action
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { roll } from "./diceSystem.js";
import { playSFX, setMusic } from "./audioSystem.js";
import { resolveAttackDamage } from "./combatDamagePipeline.js";
import {
  ecsApplyDamageToPlayer,
  ecsSetPlayerCurrentHp,
  ecsSetPlayerKnockoutState,
  ecsSetPlayerPosition,
  ecsSetPlayerTempHp,
} from "../ecs/playerEcsBridge.js";

// ── Grid constants (must match CombatMapEngine) ───────────────────────────────
const _GRID_COLS = 20;
const _GRID_ROWS = 14;

/**
 * Optional obstacle checker — injected by CombatMapEngine after it builds
 * the obstacle map so that moveParticipant can block impassable cells.
 * Signature: (x: number, y: number) => boolean
 */
let _obstacleChecker = null;

/**
 * Register a function that returns true when a grid cell is an obstacle.
 * Called once by CombatMapEngine after _buildObstacles().
 * @param {(x: number, y: number) => boolean} fn
 */
export function setObstacleChecker(fn) {
  _obstacleChecker = fn;
}

/**
 * Start a new combat encounter.
 * Rolls initiative for all participants and sets turn order.
 *
 * @param {CombatParticipant[]} participants - Players + enemies
 */
export function startCombat(participants) {
  // Separate player and enemies to auto-assign grid positions
  const enemies = participants.filter((p) => !p.isPlayer);

  const turnOrder = participants
    .map((p) => {
      // Auto-assign a starting position if the caller didn't supply one
      let autoPos;
      if (p.isPlayer) {
        autoPos = { x: 2, y: Math.floor(_GRID_ROWS / 2) };
      } else {
        const eIdx = enemies.indexOf(p);
        // Spread enemies across the right side of the grid
        autoPos = {
          x: _GRID_COLS - 3 - Math.floor(eIdx / 3),
          y: 2 + (eIdx % 3) * 4,
        };
      }
      // Alert feat: +5 initiative bonus (D&D 5e)
      const alertBonus =
        p.isPlayer && (p.feats ?? []).includes("alert") ? 5 : 0;
      const initMod = (p.initiativeModifier ?? 0) + alertBonus;
      const initNotation =
        initMod >= 0 ? `1d20+${initMod}` : `1d20-${Math.abs(initMod)}`;
      return {
        ...p,
        initiative: roll(initNotation).total,
        activeEffects: p.activeEffects ?? [],
        // Grid position — caller may override by supplying x/y directly
        x: p.x ?? autoPos.x,
        y: p.y ?? autoPos.y,
        // Movement: D&D 5e — 30 ft default = 6 squares
        movementSpeed: p.movementSpeed ?? 30,
        movementRemaining: p.movementSpeed ?? 30,
        // Weapon range in squares (1 = melee, 12 = longbow 60 ft / 5)
        weaponRange: p.weaponRange ?? 1,
      };
    })
    .sort((a, b) => b.initiative - a.initiative); // Highest first

  const state = gameStore.getState();

  gameStore.setState(
    {
      combat: {
        // Spread existing combat so combat.map (grid config) is preserved.
        ...state.combat,
        active: true,
        round: 1,
        turnOrder,
        currentTurnIndex: 0,
        currentTurnActorId: turnOrder[0]?.id ?? null,
        log: [],
      },
      // Clear any stale death-save state from a previous combat (e.g. loaded
      // from a save where the player was at 0 HP — prevents buttons locking).
      player: {
        ...state.player,
        deathSaveActive: false,
        deathSaves: { successes: 0, failures: 0 },
        conditions: (state.player.conditions ?? []).filter(
          (c) => c !== "unconscious",
        ),
      },
      // In co-op: only the first actor's player owns the turn
      session: {
        ...state.session,
        currentTurnPlayerId:
          turnOrder[0]?.playerId ?? state.session.localPlayerId,
        isMyTurn: _isMyTurn(turnOrder[0], state.session),
      },
    },
    "turnManager:startCombat",
  );

  const playerStart = turnOrder.find((p) => p.isPlayer);
  if (playerStart) {
    ecsSetPlayerPosition(playerStart.x, playerStart.y, {
      source: "turnManager:startCombatPosition",
    });
  }

  eventBus.emit(EVENTS.COMBAT_STARTED, { turnOrder });
  setMusic("combat");
  eventBus.emit(EVENTS.COMBAT_TURN_START, { current: turnOrder[0], round: 1 });

  console.log(
    "[TurnManager] Combat started. Turn order:",
    turnOrder.map((p) => p.name),
  );
}

/** Recursion depth guard — prevents infinite stun-skip loops. */
let _advanceDepth = 0;

/**
 * Advance to the next turn (call after current entity completes their action).
 * Automatically increments round counter when the last combatant finishes.
 * Processes status effects (poison / stun / regen) at the start of each turn.
 */
export function advanceTurn() {
  if (_advanceDepth > 8) {
    _advanceDepth = 0;
    console.warn(
      "[TurnManager] advanceTurn hit depth limit — breaking effect loop",
    );
    return;
  }

  const state = gameStore.getState();

  if (!state.combat.active) {
    console.warn("[TurnManager] advanceTurn() called outside combat");
    _advanceDepth = 0; // Reset so stale stun-skip timeouts don't poison next combat
    return;
  }

  const { turnOrder, currentTurnIndex, round } = state.combat;

  // Remove dead combatants before advancing.
  // Keep an unconscious player (hp=0 with 'unconscious' condition) alive so
  // death saving throws can resolve naturally before ending combat.
  const alive = turnOrder.filter((p) =>
    p.isPlayer
      ? (p.hp ?? 1) > 0 || (p.conditions ?? []).includes("unconscious")
      : (p.hp ?? 1) > 0,
  );

  if (alive.length <= 1) {
    _advanceDepth = 0;
    endCombat();
    return;
  }

  const nextIndex = (currentTurnIndex + 1) % alive.length;
  const newRound = nextIndex === 0 ? round + 1 : round;
  const current = alive[nextIndex];

  // ── Tick status effects for the incoming combatant ────────────────────────
  const { shouldSkip, updatedOrder, logEntries, effectEvents } = _tickEffects(
    current,
    alive,
  );

  // Re-check liveness — poison tick might have finished off someone
  const stillAlive = updatedOrder.filter((p) =>
    p.isPlayer
      ? (p.hp ?? 1) > 0 || (p.conditions ?? []).includes("unconscious")
      : (p.hp ?? 1) > 0,
  );
  if (stillAlive.length <= 1) {
    gameStore.setState(
      { combat: { ...state.combat, turnOrder: updatedOrder } },
      "turnManager:tickCleanup",
    );
    _advanceDepth = 0;
    endCombat();
    return;
  }

  // Re-check liveness after ticks, then reset movement for the incoming combatant.
  // Use updatedOrder (not stillAlive) so dead combatants stay in turnOrder for display.
  const withMovReset = updatedOrder.map((p) =>
    p.id === current.id
      ? { ...p, movementRemaining: p.movementSpeed ?? 30 }
      : p,
  );

  // Sync player HP in state.player if a tick changed it
  const updatedPlayer = withMovReset.find((p) => p.isPlayer);
  const shouldSyncPlayerHp =
    !!updatedPlayer && updatedPlayer.hp !== state.player.hp;

  gameStore.setState(
    {
      combat: {
        ...state.combat,
        turnOrder: withMovReset,
        currentTurnIndex: nextIndex,
        currentTurnActorId: current.id,
        round: newRound,
      },
      session: {
        ...state.session,
        currentTurnPlayerId: current.playerId ?? state.session.localPlayerId,
        // Stunned combatants never get to act — hide player buttons immediately
        isMyTurn: shouldSkip ? false : _isMyTurn(current, state.session),
      },
    },
    "turnManager:advanceTurn",
  );

  if (shouldSyncPlayerHp) {
    ecsSetPlayerCurrentHp(updatedPlayer.hp, {
      source: "turnManager:advanceTurnHpSync",
    });
  }

  // Flush log entries produced by effect ticks
  logEntries.forEach((entry) => logCombatAction(entry));

  // Emit per-effect VFX events (FCT on cards, etc.)
  effectEvents.forEach((ev) => eventBus.emit(EVENTS.STATUS_EFFECT_TICKED, ev));

  // ── DEATH SAVE PAUSE FROM STATUS EFFECTS ──
  // If the player succumbed to poison/fire at the start of their turn:
  const wasKnockedOut =
    updatedPlayer && updatedPlayer.hp === 0 && (state.player.hp ?? 0) > 0;
  if (wasKnockedOut) {
    _handlePlayerKnockout();
    // Do NOT emit COMBAT_TURN_START; pause combat for death saves.
    return;
  }

  // ── DEATH SAVE PAUSE (already active) ──
  // If the player is already making death saves, skip turn processing.
  if (gameStore.getState().player?.deathSaveActive) {
    console.log(
      "[TurnManager] advanceTurn paused because player is making death saves",
    );
    return;
  }

  if (shouldSkip) {
    // Emit with stunned flag so CombatUI renders the indicator but skips enemy AI
    eventBus.emit(EVENTS.COMBAT_TURN_START, {
      current,
      round: newRound,
      stunned: true,
    });
    _advanceDepth++;
    // NOTE: do NOT reset _advanceDepth here — the guard at the top of
    // advanceTurn() must stay active across all chained stun-skip calls.
    setTimeout(() => {
      advanceTurn();
    }, 1200);
    return;
  }

  _advanceDepth = 0;
  eventBus.emit(EVENTS.COMBAT_TURN_START, { current, round: newRound });
}

/**
 * Apply damage to a combatant and update the turn order.
 *
 * @param {string} targetId
 * @param {number} damage
 */
export function applyDamage(targetId, damage, options = {}) {
  const state = gameStore.getState();

  const _rageTarget = state.combat.turnOrder.find((p) => p.id === targetId);
  const isPlayer = _rageTarget?.isPlayer ?? false;

  // 1) Priority event-bus damage pipeline (ArmorSystem -> DamageSystem -> LoggingSystem)
  // Can be bypassed when damage was already pre-processed by async attack flow.
  const shouldUseDamagePipeline = options.useDamagePipeline !== false;
  if (shouldUseDamagePipeline) {
    const pipelineResult = resolveAttackDamage({
      targetId,
      targetIsPlayer: isPlayer,
      amount: damage,
      isCritical: options.isCrit === true,
      damageType: options.damageType ?? "physical",
      extraReduction: options.armorReduction ?? 0,
    });

    damage = pipelineResult.amount;
  }

  // 2) Class-based mitigation after armor pipeline (Barbarian Rage)
  if (isPlayer && (state.player.classAbilities?.rageActive ?? false)) {
    const dtype = options.damageType ?? "physical";
    const physical = ["physical", "bludgeoning", "piercing", "slashing"];
    if (physical.includes(dtype)) {
      damage = Math.max(1, Math.floor(damage / 2));
      options = { ...options, _rageResisted: true };
    }
  }

  let playerDamageResult = null;

  if (isPlayer) {
    playerDamageResult = ecsApplyDamageToPlayer(damage, {
      useTempHp: true,
      source: "turnManager:applyDamage",
    });

    if (playerDamageResult.absorbedTempHp > 0) {
      eventBus.emit(EVENTS.TEMP_HP_ABSORBED, {
        targetId,
        absorbed: playerDamageResult.absorbedTempHp,
        remaining: playerDamageResult.remainingTempHp,
      });
    }

    damage = playerDamageResult.appliedDamage;
    if (damage <= 0) return; // all damage absorbed
  }

  const turnOrder = state.combat.turnOrder.map((p) => {
    if (p.id !== targetId) return p;
    const nextHp = isPlayer
      ? (playerDamageResult?.newCurrentHp ?? p.hp ?? p.maxHp ?? 0)
      : Math.max(0, (p.hp ?? p.maxHp ?? 0) - damage);
    return { ...p, hp: nextHp };
  });

  gameStore.setState(
    {
      combat: { ...state.combat, turnOrder },
    },
    "turnManager:applyDamage",
  );
  playSFX("attack_hit");
  eventBus.emit(EVENTS.COMBATANT_DAMAGED, {
    targetId,
    damage,
    isCrit: options.isCrit ?? false,
  });

  const target = turnOrder.find((p) => p.id === targetId);
  if (target?.hp === 0) {
    console.log(`[TurnManager] ${target.name} dropped to 0 HP`);
  }

  // Concentration check: player takes damage while concentrating on a spell
  if (isPlayer && damage > 0) {
    const postP = gameStore.getState().player;
    const conc = postP.concentration;
    if (conc) {
      const dc = Math.max(10, Math.ceil(damage / 2));
      const conMod = Math.floor(((postP.abilities?.con ?? 10) - 10) / 2);
      // War Caster feat: advantage on Concentration saves
      const warCasterAdv = (postP.feats ?? []).includes("war_caster");
      const baseNotation = conMod >= 0 ? `+${conMod}` : `-${Math.abs(conMod)}`;
      const notation = warCasterAdv
        ? `2d20kh1${baseNotation}`
        : `1d20${baseNotation}`;
      const conSave = roll(notation).total;
      if (conSave >= dc) {
        logCombatAction({
          actor: postP.name,
          action: "maintains Concentration",
          result: `CON save ${conSave} vs DC ${dc} ✓ — ${conc.spellName} continues`,
        });
      } else {
        const p2 = gameStore.getState().player;
        gameStore.setState(
          { player: { ...p2, concentration: null } },
          "turnManager:breakConcentration",
        );
        logCombatAction({
          actor: p2.name,
          action: "loses Concentration",
          result: `CON save ${conSave} vs DC ${dc} ✗ — ${conc.spellName} ends!`,
        });
        eventBus.emit(EVENTS.CONCENTRATION_BROKEN, {
          spellId: conc.spellId,
          spellName: conc.spellName,
          // Pass bonus data in payload — spellSystem reads this BEFORE store is cleared
          appliedAcBonus: conc.appliedAcBonus ?? 0,
          appliedAttackBonus: conc.appliedAttackBonus ?? 0,
        });
      }
    }
  }
}

/**
 * Log a combat event to the combat log slice.
 *
 * @param {{ actor: string, action: string, result: string }} entry
 */
export function logCombatAction(entry) {
  const state = gameStore.getState();
  const newLog = [
    ...state.combat.log,
    { ...entry, round: state.combat.round, timestamp: Date.now() },
  ];

  gameStore.setState(
    {
      combat: { ...state.combat, log: newLog },
    },
    "turnManager:logAction",
  );
}

// ── Status Effects ────────────────────────────────────────────────────────────

/**
 * Apply (or refresh) a status effect on a combatant.
 * Safe to call from spells, items, or enemy abilities.
 *
 * @param {string} targetId
 * @param {{ id: 'poison'|'stun'|'regen', duration: number }} effect
 */
export function applyStatusEffect(targetId, effect) {
  const state = gameStore.getState();
  const turnOrder = state.combat.turnOrder.map((p) => {
    if (p.id !== targetId) return p;
    // Replace existing instance of same effect then append fresh one
    const rest = (p.activeEffects ?? []).filter((e) => e.id !== effect.id);
    return { ...p, activeEffects: [...rest, { ...effect }] };
  });
  gameStore.setState(
    { combat: { ...state.combat, turnOrder } },
    "turnManager:applyStatusEffect",
  );
  eventBus.emit(EVENTS.STATUS_EFFECT_APPLIED, { targetId, effect });
}

/**
 * Grant temporary HP to the player.
 * Temp HP does not stack — only the highest total is kept.
 *
 * @param {string} targetId
 * @param {number} amount
 */
export function grantTempHp(targetId, amount) {
  const state = gameStore.getState();
  const isPlayerTarget =
    state.combat.turnOrder.find((p) => p.id === targetId)?.isPlayer ?? false;
  if (!isPlayerTarget) return;
  const newTempHp = Math.max(state.player.tempHp ?? 0, amount);
  ecsSetPlayerTempHp(newTempHp, { source: "turnManager:grantTempHp" });
  logCombatAction({
    actor: state.player.name,
    action: "gains Temp HP",
    result: `+${amount} temporary HP`,
  });
}

// ── Grid Movement & Range ──────────────────────────────────────────────────────

/**
 * Chebyshev distance — the D&D 5e grid rule where diagonal = 1 square.
 * Both a and b must have { x: number, y: number }.
 *
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number} distance in grid squares
 */
export function calcDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Move a participant to a new grid cell, consuming movement points.
 * Validates that the destination is reachable and unoccupied.
 *
 * @param {string} participantId
 * @param {number} toX
 * @param {number} toY
 * @returns {{ ok: boolean, reason?: string }}
 */
export function moveParticipant(participantId, toX, toY) {
  const state = gameStore.getState();
  const { turnOrder } = state.combat;

  const mover = turnOrder.find((p) => p.id === participantId);
  if (!mover) return { ok: false, reason: "Participant not found" };

  // Destination bounds check
  const { cols, rows } = state.combat.map;
  if (toX < 0 || toX >= cols || toY < 0 || toY >= rows) {
    return { ok: false, reason: "Out of bounds" };
  }

  // Destination must not be occupied by a living combatant
  const occupied = turnOrder.some(
    (p) =>
      p.id !== participantId && p.x === toX && p.y === toY && (p.hp ?? 1) > 0,
  );
  if (occupied) return { ok: false, reason: "Cell is occupied" };

  // Obstacle check (injected by CombatMapEngine)
  if (_obstacleChecker && _obstacleChecker(toX, toY)) {
    return { ok: false, reason: "Cell is blocked by an obstacle" };
  }

  // Cost: Chebyshev distance × 5 ft per square
  const dist = calcDistance(mover, { x: toX, y: toY });
  const costFt = dist * 5;
  if (costFt > (mover.movementRemaining ?? 0)) {
    return { ok: false, reason: "Not enough movement remaining" };
  }

  const { x: fromX, y: fromY } = mover;

  // Opportunity Attack: enemy moves out of the player's melee threat zone (adjacent → far)
  if (!mover.isPlayer) {
    const playerCombatant = turnOrder.find(
      (p) => p.isPlayer && (p.hp ?? 1) > 0,
    );
    if (playerCombatant) {
      const wasAdjacent = calcDistance(mover, playerCombatant) <= 1;
      const willBeAdjacent =
        calcDistance({ x: toX, y: toY }, playerCombatant) <= 1;
      if (wasAdjacent && !willBeAdjacent) {
        eventBus.emit(EVENTS.OPPORTUNITY_ATTACK, {
          enemyId: mover.id,
          enemyName: mover.name,
        });
      }
    }
  }

  const newOrder = turnOrder.map((p) =>
    p.id !== participantId
      ? p
      : {
          ...p,
          x: toX,
          y: toY,
          movementRemaining: p.movementRemaining - costFt,
        },
  );

  gameStore.setState(
    { combat: { ...state.combat, turnOrder: newOrder } },
    "turnManager:moveParticipant",
  );

  if (mover.isPlayer) {
    ecsSetPlayerPosition(toX, toY, {
      source: "turnManager:moveParticipant",
    });
  }

  eventBus.emit(EVENTS.COMBAT_MAP_MOVE, {
    participantId,
    fromX,
    fromY,
    toX,
    toY,
  });

  return { ok: true };
}

/**
 * Process all status effects on a combatant at the start of their turn.
 * Pure — only computes what changes, does NOT call setState.
 *
 * @param {CombatParticipant}   participant
 * @param {CombatParticipant[]} turnOrder
 * @returns {{ shouldSkip: boolean, updatedOrder: CombatParticipant[], logEntries: Array, effectEvents: Array }}
 */
function _tickEffects(participant, turnOrder) {
  const effects = participant.activeEffects ?? [];
  if (effects.length === 0) {
    return {
      shouldSkip: false,
      updatedOrder: turnOrder,
      logEntries: [],
      effectEvents: [],
    };
  }

  let shouldSkip = false;
  let hpDelta = 0;
  const logEntries = [];
  const effectEvents = [];
  const survivingEffects = [];

  for (const effect of effects) {
    const newDuration = effect.duration - 1;

    switch (effect.id) {
      case "poison": {
        const dmg = roll("1d4").total;
        hpDelta -= dmg;
        logEntries.push({
          actor: participant.name,
          action: "writhes in poison",
          result: `takes ${dmg} damage`,
        });
        effectEvents.push({
          targetId: participant.id,
          effectId: "poison",
          delta: -dmg,
        });
        break;
      }
      case "stun": {
        shouldSkip = true;
        logEntries.push({
          actor: participant.name,
          action: "is stunned",
          result: "turn skipped!",
        });
        effectEvents.push({
          targetId: participant.id,
          effectId: "stun",
          delta: 0,
        });
        break;
      }
      case "regen": {
        const heal = roll("1d4").total;
        hpDelta += heal;
        logEntries.push({
          actor: participant.name,
          action: "regenerates",
          result: `+${heal} HP`,
        });
        effectEvents.push({
          targetId: participant.id,
          effectId: "regen",
          delta: heal,
        });
        break;
      }
      case "burning": {
        const fireDmg = roll("1d4").total;
        hpDelta -= fireDmg;
        logEntries.push({
          actor: participant.name,
          action: "burns",
          result: `takes ${fireDmg} fire damage`,
        });
        effectEvents.push({
          targetId: participant.id,
          effectId: "burning",
          delta: -fireDmg,
        });
        break;
      }
      case "bleeding": {
        const bleedDmg = roll("1d6").total;
        hpDelta -= bleedDmg;
        logEntries.push({
          actor: participant.name,
          action: "bleeds",
          result: `takes ${bleedDmg} damage`,
        });
        effectEvents.push({
          targetId: participant.id,
          effectId: "bleeding",
          delta: -bleedDmg,
        });
        break;
      }
      case "frightened": {
        // Disadvantage on attacks — applied at attack time; just log the condition tick
        logEntries.push({
          actor: participant.name,
          action: "is frightened",
          result: "attacks this turn at Disadvantage",
        });
        effectEvents.push({
          targetId: participant.id,
          effectId: "frightened",
          delta: 0,
        });
        break;
      }
      case "blinded": {
        // Own attacks: disadvantage; enemy attacks against them: advantage
        logEntries.push({
          actor: participant.name,
          action: "is blinded",
          result: "attacks at Disadvantage, easier to hit",
        });
        effectEvents.push({
          targetId: participant.id,
          effectId: "blinded",
          delta: 0,
        });
        break;
      }
      case "prone": {
        logEntries.push({
          actor: participant.name,
          action: "is prone",
          result:
            "attacks at Disadvantage; melee attacks against them have Advantage",
        });
        effectEvents.push({
          targetId: participant.id,
          effectId: "prone",
          delta: 0,
        });
        break;
      }
      default:
        break;
    }

    if (newDuration > 0)
      survivingEffects.push({ ...effect, duration: newDuration });
  }

  // Apply HP delta — capped at [0, maxHp]
  const updatedOrder = turnOrder.map((p) => {
    if (p.id !== participant.id) return p;
    const newHp = Math.max(
      0,
      Math.min(p.maxHp ?? p.hp ?? 0, (p.hp ?? 0) + hpDelta),
    );
    return { ...p, hp: newHp, activeEffects: survivingEffects };
  });

  return { shouldSkip, updatedOrder, logEntries, effectEvents };
}

/**
 * End combat and reset the combat slice.
 * Automatically determines victory vs defeat from surviving combatants.
 */
export function endCombat() {
  const state = gameStore.getState();

  // Victory when all enemies are down — even if the player is unconscious
  // (death saves resolved, allies dragged them to safety).
  const enemies = state.combat.turnOrder.filter((p) => !p.isPlayer);
  const allEnemiesDead =
    enemies.length === 0 || enemies.every((e) => (e.hp ?? 0) <= 0);
  const outcome = allEnemiesDead ? "victory" : "defeat";

  gameStore.setState(
    {
      // Sync final player HP to state.player (already authoritative, kept for clarity)
      player: { ...state.player, hp: state.player.hp },
      combat: {
        // Spread so combat.map (grid config) survives into the idle state.
        ...state.combat,
        active: false,
        round: 0,
        turnOrder: [],
        currentTurnIndex: 0,
        log: state.combat.log, // Preserve log for DM context
      },
      session: {
        ...state.session,
        currentTurnPlayerId: null,
        isMyTurn: true,
      },
    },
    "turnManager:endCombat",
  );

  playSFX(outcome === "victory" ? "victory" : "death");
  setMusic(outcome === "victory" ? "town" : "dungeon");
  eventBus.emit(EVENTS.COMBAT_ENDED, { outcome });
  if (outcome === "victory") {
    const defeated = state.combat.turnOrder.filter(
      (p) => !p.isPlayer && (p.hp ?? 1) <= 0,
    );
    const survivors = state.combat.turnOrder.filter((p) => (p.hp ?? 0) > 0);
    eventBus.emit(EVENTS.COMBAT_VICTORY, { survivors, defeated });
  } else {
    eventBus.emit(EVENTS.COMBAT_DEFEAT, {});
  }

  console.log(`[TurnManager] Combat ended — ${outcome}.`);
}

/**
 * Check if it is the local player's turn.
 * In solo mode this is always true.
 * In co-op, compares the active combatant's playerId to localPlayerId.
 *
 * @private
 */
function _isMyTurn(current, session) {
  // In solo mode: player controls only their own character, not enemies.
  // Return true only when the current combatant is the player.
  if (session.mode === "solo") return current?.isPlayer ?? false;
  return current?.playerId === session.localPlayerId;
}

// ── Enemy AI ──────────────────────────────────────────────────────────────────

/**
 * Execute one enemy's turn via the Groq-powered Combat AI.
 * Delegates to combatManager to avoid circular imports while keeping
 * CombatUI's existing `runEnemyTurn` call site unchanged.
 *
 * @param {CombatParticipant} enemy    The active enemy snapshot
 * @param {number} [thinkMs=800]       Pre-action pause in ms
 */
export async function runEnemyTurn(enemy, thinkMs = 800) {
  const { runAITurn } = await import("./combatManager.js");
  return runAITurn(enemy, thinkMs);
}

/**
 * Handle the player dropping to 0 HP.
 * Public wrapper so combatManager can call it without a circular import.
 */
export function handlePlayerKnockout() {
  _handlePlayerKnockout();
}

/**
 * Handle the player dropping to 0 HP.
 * Sets the "unconscious" condition and emits PLAYER_KNOCKED_OUT.
 * CombatUI listens for this to show death saves.
 * @private
 */
function _handlePlayerKnockout() {
  const state = gameStore.getState();
  const conditions = [...new Set([...state.player.conditions, "unconscious"])];

  // Also sync "unconscious" into the player's turn-order entry so that
  // advanceTurn()'s alive filter keeps them in the rotation for death saves.
  // Without this, p.conditions on the turn-order entry never contains
  // "unconscious" and the player is silently dropped from the alive list,
  // causing both: (a) button never re-arming, and (b) enemies looping forever.
  const turnOrder = (state.combat?.turnOrder ?? []).map((p) =>
    p.isPlayer ? { ...p, conditions } : p,
  );

  ecsSetPlayerKnockoutState(
    {
      hp: 0,
      conditions,
      deathSaves: { successes: 0, failures: 0 },
      deathSaveActive: true,
    },
    { source: "turnManager:playerKnockout" },
  );

  gameStore.setState(
    {
      combat: { ...state.combat, turnOrder },
    },
    "turnManager:playerKnockoutCombat",
  );

  eventBus.emit(EVENTS.PLAYER_KNOCKED_OUT, {
    playerName: state.player.name,
  });

  console.log(
    "[TurnManager] Player knocked to 0 HP — death saving throws begin. Combat continues.",
  );
  // NOTE: endCombat() is NOT called here — the death save UI in CombatUI
  // handles the resolution (stable → resume, dead → endCombat).
}

/**
 * @typedef {Object} CombatParticipant
 * @property {string}  id
 * @property {string}  name
 * @property {boolean} isPlayer
 * @property {string}  [playerId]   - Multiplayer: which player controls this
 * @property {number}  [hp]
 * @property {number}  [maxHp]
 * @property {number}  [ac]
 * @property {number}  [initiativeModifier]
 */
