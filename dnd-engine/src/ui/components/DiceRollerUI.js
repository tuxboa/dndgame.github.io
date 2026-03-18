/**
 * DiceRollerUI.js
 *
 * Legacy compatibility wrapper.
 * All roll UX now uses DiceBoxUI (clickable overlay + new animation style).
 *
 * Public API:
 *   initDiceUI()                          - wire event bus to new dice UI
 *   animate(notation, result)             - fire-and-forget auto roll display
 *   promptRollAndAnimate(notation, label) - paused player roll, resolves with RollResult
 *   showToast(notation, result)           - compatibility alias for auto display
 */

import { eventBus, EVENTS } from "../../engine/eventBus.js";
import { roll } from "../../systems/diceSystem.js";
import { gameStore } from "../../store/index.js";
import { showAutoRoll, waitForRoll } from "./Dice3DUI.js"; // 3D D20 dice

let _ready = false;
let _rollRequestQueue = Promise.resolve();

export function initDiceUI() {
  if (_ready) return;
  _ready = true;
  console.log("[DiceUI] Using DiceBoxUI as the unified roll renderer.");

  eventBus.on(EVENTS.DICE_ANIMATE, ({ notation, result }) => {
    animate(notation, result).catch(() => {});
  });

  eventBus.on(EVENTS.DICE_ROLL_REQUESTED, (payload = {}) => {
    _rollRequestQueue = _rollRequestQueue
      .then(() => _handleRequestedRoll(payload))
      .catch((error) => {
        console.error("[DiceUI] Requested roll handler failed:", error);
      });
  });
}

export function animate(notation, result) {
  const sides = _parseSides(notation);
  return showAutoRoll({
    sides,
    result: _extractDisplayValue(result, sides),
    instructions: _buildInstruction(notation, result),
    rollAnimationMs: 320,
    resultHoldMs: 420,
  });
}

export function promptRollAndAnimate(notation, label = "Roll Dice") {
  const sides = _parseSides(notation);
  return waitForRoll({
    sides,
    instructions: `${label} (${notation})`,
    rollAnimationMs: 500,
    resultHoldMs: 700,
    getResult: () => roll(notation),
    displayValue: (result) => _extractDisplayValue(result, sides),
  });
}

export function showToast(notation, result) {
  return animate(notation, result);
}

function _parseSides(notation) {
  const m = notation.match(/d(\d+)/i);
  return m ? parseInt(m[1], 10) : 20;
}

function _extractDisplayValue(result, fallbackSides = 6) {
  if (!result) return _randomDisplayFallback(fallbackSides);
  if (typeof result === "number") return Math.max(1, Math.floor(result));
  return (
    result.used?.[0] ??
    result.dice?.[0] ??
    result.total ??
    _randomDisplayFallback(fallbackSides)
  );
}

function _randomDisplayFallback(sides) {
  const max = Math.max(2, Math.floor(sides ?? 6));
  return Math.floor(Math.random() * max) + 1;
}

function _buildInstruction(notation, result) {
  const total = result?.total;
  if (typeof total === "number") {
    return `${notation} = ${total}`;
  }
  return notation;
}

function _normaliseAbility(ability) {
  const raw = String(ability ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "dex";

  const mapping = {
    strength: "str",
    str: "str",
    dexterity: "dex",
    dex: "dex",
    constitution: "con",
    con: "con",
    intelligence: "int",
    int: "int",
    wisdom: "wis",
    wis: "wis",
    charisma: "cha",
    cha: "cha",
  };

  return mapping[raw] ?? "dex";
}

function _abilityLabel(abilityKey) {
  const labels = {
    str: "Strength",
    dex: "Dexterity",
    con: "Constitution",
    int: "Intelligence",
    wis: "Wisdom",
    cha: "Charisma",
  };

  return labels[abilityKey] ?? "Ability";
}

function _resolveAbilityModifier(ability, explicitModifier) {
  if (Number.isFinite(explicitModifier)) return Number(explicitModifier);

  const abilityKey = _normaliseAbility(ability);
  const score = Number(
    gameStore.getState().player?.abilities?.[abilityKey] ?? 10,
  );
  return Math.floor((score - 10) / 2);
}

async function _handleRequestedRoll(payload = {}) {
  const requestId =
    typeof payload.requestId === "string" && payload.requestId.trim().length
      ? payload.requestId.trim()
      : `dice-request-${Date.now()}`;

  const abilityKey = _normaliseAbility(payload.ability);
  const dcRaw = Number(payload.dc);
  const dc = Number.isFinite(dcRaw) ? Math.max(1, Math.floor(dcRaw)) : 10;

  const modifier = _resolveAbilityModifier(abilityKey, payload.modifier);
  const sign = modifier >= 0 ? "+" : "-";
  const absModifier = Math.abs(modifier);

  const notation =
    typeof payload.notation === "string" && payload.notation.trim().length
      ? payload.notation.trim()
      : `1d20${sign}${absModifier}`;

  const label = `${_abilityLabel(abilityKey)} Check (DC ${dc})`;
  const result = await promptRollAndAnimate(notation, label);
  const total = Number(result?.total ?? 0);
  const success = total >= dc;

  const response = {
    ...payload,
    requestId,
    ability: abilityKey,
    dc,
    notation,
    result,
    total,
    success,
  };

  eventBus.emit(EVENTS.DICE_ROLL_RESULT, response);
  eventBus.emit(EVENTS.DICE_ROLL_COMPLETED, response);
}
