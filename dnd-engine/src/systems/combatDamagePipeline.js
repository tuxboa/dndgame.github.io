import { eventBus, EVENTS } from "../engine/eventBus.js";
import { getEquippedInSlot } from "./equipmentSystem.js";
import { waitForRoll } from "../ui/components/DiceBoxUI.js";

let _initialized = false;

function _wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * AttackStartBridgeSystem (prio 100): receives COMBAT_ATTACK_START and
 * forwards its mutable payload into the damage pipeline.
 */
async function _attackStartBridgeSystem(payload) {
  if (!payload || typeof payload !== "object") return;

  const animationMs = Math.max(0, Math.floor(payload.animationMs ?? 0));
  if (animationMs > 0) {
    await _wait(animationMs);
  }

  if (payload.waitForPlayerRoll === true && payload.damagePayload) {
    const manualRoll = await waitForRoll({
      sides: Math.max(2, Math.floor(payload.diceSides ?? 6)),
      instructions: payload.dicePrompt ?? "Kattints a kockára a dobáshoz!",
      rollAnimationMs: Math.max(0, Math.floor(payload.rollAnimationMs ?? 500)),
      resultHoldMs: Math.max(0, Math.floor(payload.resultHoldMs ?? 800)),
    });

    payload.damagePayload.meta = {
      ...(payload.damagePayload.meta ?? {}),
      manualRoll,
    };

    if (payload.applyManualRollAsBonus === true) {
      payload.damagePayload.amount = Math.max(
        0,
        Math.floor(payload.damagePayload.amount ?? 0) + manualRoll,
      );
      payload.damagePayload.meta.manualRollAppliedAsBonus = true;
    }
  }

  if (!payload.damagePayload) return;
  await eventBus.publish(EVENTS.DAMAGE_APPLIED, payload.damagePayload);
}

/**
 * ArmorSystem (prio 10): mutates payload.amount before damage is applied.
 *
 * Payload shape:
 * {
 *   targetId: string,
 *   amount: number,
 *   originalAmount: number,
 *   damageType?: string,
 *   targetIsPlayer?: boolean,
 *   meta?: object,
 * }
 */
function _armorSystem(payload) {
  if (!payload || typeof payload !== "object") return;

  const original = Math.max(0, Math.floor(payload.amount ?? 0));
  if (original <= 0) {
    payload.amount = 0;
    return;
  }

  const damageType = payload.damageType ?? "physical";
  const isPhysical = [
    "physical",
    "bludgeoning",
    "piercing",
    "slashing",
  ].includes(damageType);

  // Keep this conservative so we don't heavily rebalance combat:
  // physical hits only, player target only, small reduction derived from armor AC bonuses.
  let armorReduction = 0;
  if (payload.targetIsPlayer && isPhysical) {
    const armorAcBonus = getEquippedInSlot("armor")?.bonuses?.acBonus ?? 0;
    const offhandAcBonus = getEquippedInSlot("offhand")?.bonuses?.acBonus ?? 0;
    armorReduction = Math.floor((armorAcBonus + offhandAcBonus) / 3);
  }

  // Allow caller to inject additional reduction explicitly.
  armorReduction += Math.max(0, Math.floor(payload.extraReduction ?? 0));

  payload.meta = {
    ...(payload.meta ?? {}),
    armorReduction,
  };

  payload.amount = Math.max(0, original - armorReduction);
}

/**
 * DamageSystem (prio 0): normalizes and finalizes the mutable amount.
 */
function _damageSystem(payload) {
  if (!payload || typeof payload !== "object") return;
  payload.amount = Math.max(0, Math.floor(payload.amount ?? 0));
  payload.meta = {
    ...(payload.meta ?? {}),
    finalAmount: payload.amount,
  };
}

/**
 * LoggingSystem (prio -10): logs final attack damage after all modifiers.
 */
function _loggingSystem(payload) {
  if (!payload || typeof payload !== "object") return;

  if (!import.meta.env.DEV) return;

  const original = payload.originalAmount ?? payload.amount ?? 0;
  const final = payload.amount ?? 0;
  const reduction = payload.meta?.armorReduction ?? 0;
  const isCritical = payload.isCritical === true;

  console.log(
    `[DamagePipeline] target=${payload.targetId} original=${original} final=${final} reduction=${reduction} type=${payload.damageType ?? "physical"} critical=${isCritical}`,
  );
}

/**
 * Initializes priority-ordered listeners for combat attack damage processing.
 * Safe to call multiple times.
 */
export function initCombatDamagePipeline() {
  if (_initialized) return;

  eventBus.on(EVENTS.COMBAT_ATTACK_START, _attackStartBridgeSystem, 100);

  // Higher priority executes first.
  eventBus.on(EVENTS.DAMAGE_APPLIED, _armorSystem, 10);
  eventBus.on(EVENTS.DAMAGE_APPLIED, _damageSystem, 0);
  eventBus.on(EVENTS.DAMAGE_APPLIED, _loggingSystem, -10);

  _initialized = true;
}

/**
 * Publish a mutable attack-damage payload through the priority bus.
 * Returns the same payload object after all systems have run.
 *
 * @param {object} input
 * @returns {object}
 */
export function resolveAttackDamage(input) {
  const payload = {
    targetId: input?.targetId ?? "unknown",
    targetIsPlayer: input?.targetIsPlayer ?? false,
    damageType: input?.damageType ?? "physical",
    isCritical: input?.isCritical === true,
    originalAmount: Math.max(0, Math.floor(input?.amount ?? 0)),
    amount: Math.max(0, Math.floor(input?.amount ?? 0)),
    extraReduction: Math.max(0, Math.floor(input?.extraReduction ?? 0)),
    meta: { ...(input?.meta ?? {}) },
  };

  eventBus.emit(EVENTS.DAMAGE_APPLIED, payload);
  return payload;
}

/**
 * Asynchronous attack damage flow:
 * 1) publish COMBAT_ATTACK_START
 * 2) Start bridge publishes DAMAGE_APPLIED
 * 3) Armor/Damage/Logging run in priority order via async publish
 *
 * @param {object} input
 * @param {{
 *   animationMs?: number,
 *   skipAnimation?: boolean,
 *   waitForPlayerRoll?: boolean,
 *   diceSides?: number,
 *   dicePrompt?: string,
 *   rollAnimationMs?: number,
 *   resultHoldMs?: number,
 *   applyManualRollAsBonus?: boolean,
 * }} [options]
 * @returns {Promise<object>}
 */
export async function resolveAttackDamageAsync(input, options = {}) {
  const payload = {
    targetId: input?.targetId ?? "unknown",
    targetIsPlayer: input?.targetIsPlayer ?? false,
    damageType: input?.damageType ?? "physical",
    isCritical: input?.isCritical === true,
    originalAmount: Math.max(0, Math.floor(input?.amount ?? 0)),
    amount: Math.max(0, Math.floor(input?.amount ?? 0)),
    extraReduction: Math.max(0, Math.floor(input?.extraReduction ?? 0)),
    meta: { ...(input?.meta ?? {}) },
  };

  const animationMs = options.skipAnimation
    ? 0
    : Math.max(0, Math.floor(options.animationMs ?? 0));

  await eventBus.publish(EVENTS.COMBAT_ATTACK_START, {
    targetId: payload.targetId,
    animationMs,
    waitForPlayerRoll: options.waitForPlayerRoll === true,
    diceSides: options.diceSides,
    dicePrompt: options.dicePrompt,
    rollAnimationMs: options.rollAnimationMs,
    resultHoldMs: options.resultHoldMs,
    applyManualRollAsBonus: options.applyManualRollAsBonus === true,
    damagePayload: payload,
  });

  return payload;
}
