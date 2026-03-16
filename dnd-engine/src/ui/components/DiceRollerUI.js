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
import { showAutoRoll, waitForRoll } from "./DiceBoxUI.js";

let _ready = false;

export function initDiceUI() {
  if (_ready) return;
  _ready = true;
  console.log("[DiceUI] Using DiceBoxUI as the unified roll renderer.");

  eventBus.on(EVENTS.DICE_ANIMATE, ({ notation, result }) => {
    animate(notation, result).catch(() => {});
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
