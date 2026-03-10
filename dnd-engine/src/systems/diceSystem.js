/**
 * diceSystem.js — Pure dice logic using @dice-roller/rpg-dice-roller
 *
 * All exported functions maintain the same API as before so no callers break.
 * The heavy lifting (parsing + RNG) is now delegated to the library.
 */

import { DiceRoll } from "@dice-roller/rpg-dice-roller";

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Convert a ParsedNotation back to a notation string.
 * Used when callers pass a parsed object to roll().
 */
function parsedToString({ count, sides, modifier, keep, keepCount }) {
  let str = `${count}d${sides}`;
  if (keep) {
    const kh = keep === "high" ? "kh" : "kl";
    str += `${kh}${keepCount}`;
  }
  if (modifier > 0) str += `+${modifier}`;
  else if (modifier < 0) str += `${modifier}`;
  return str;
}

/**
 * Extract individual die values from an rpg-dice-roller DiceRoll result.
 * Returns { allDice, usedDice, droppedDice, modifier }.
 */
function extractDiceValues(diceRoll) {
  const allDice = [];
  const usedDice = [];
  const droppedDice = [];
  let modifier = 0;

  for (const group of diceRoll.rolls) {
    if (group && typeof group === "object" && group.rolls) {
      // Dice group — each entry is an individual die result
      for (const die of group.rolls) {
        const v = die.value;
        allDice.push(v);
        if (die.useInTotal === false) {
          droppedDice.push(v);
        } else {
          usedDice.push(v);
        }
      }
    } else if (typeof group === "number") {
      // Arithmetic modifier (+3, -1, etc.)
      modifier += group;
    }
  }

  return { allDice, usedDice, droppedDice, modifier };
}

// ── Notation Parser ───────────────────────────────────────────────────────────

/**
 * Parse a dice notation string into structured parts.
 *
 * Supports:
 *   "1d20"       => { count:1, sides:20, modifier:0 }
 *   "2d6+3"      => { count:2, sides:6,  modifier:3 }
 *   "1d8-1"      => { count:1, sides:8,  modifier:-1 }
 *   "d20"        => { count:1, sides:20, modifier:0 }
 *   "4d6kh3"     => { count:4, sides:6,  keep:'high', keepCount:3, modifier:0 }
 *   "2d20kh1"    => advantage
 *   "2d20kl1"    => disadvantage
 *
 * @param {string} notation
 * @returns {ParsedNotation}
 */
export function parseNotation(notation) {
  const clean = notation
    .toLowerCase()
    .replace(/\s/g, "")
    .replace(/\+-/g, "-")
    .replace(/--/g, "+");

  const keepMatch = clean.match(/^(\d*)d(\d+)k([hl])(\d+)([+-]\d+)?$/);
  if (keepMatch) {
    return {
      count: parseInt(keepMatch[1] || "1"),
      sides: parseInt(keepMatch[2]),
      keep: keepMatch[3] === "h" ? "high" : "low",
      keepCount: parseInt(keepMatch[4]),
      modifier: parseInt(keepMatch[5] || "0"),
    };
  }

  const stdMatch = clean.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!stdMatch) throw new Error(`Invalid dice notation: "${notation}"`);

  return {
    count: parseInt(stdMatch[1] || "1"),
    sides: parseInt(stdMatch[2]),
    modifier: parseInt(stdMatch[3] || "0"),
    keep: null,
    keepCount: null,
  };
}

// ── Roll Execution ────────────────────────────────────────────────────────────

/**
 * Roll dice using rpg-dice-roller and return a RollResult.
 *
 * @param {string|ParsedNotation} notation
 * @returns {RollResult}
 */
export function roll(notation) {
  const notationStr =
    typeof notation === "string" ? notation : parsedToString(notation);

  const diceRoll = new DiceRoll(notationStr);
  const { allDice, usedDice, droppedDice, modifier } =
    extractDiceValues(diceRoll);

  const subtotal = usedDice.reduce((a, b) => a + b, 0);

  return {
    notation: notationStr,
    dice: allDice, // All dice rolled (before keep filter)
    used: usedDice, // Dice that count toward total
    dropped: droppedDice, // Dice that were dropped
    modifier,
    subtotal,
    total: diceRoll.total,
    timestamp: Date.now(),
  };
}

// ── D&D 5e Helpers ────────────────────────────────────────────────────────────

/** Roll with advantage (2d20, keep highest). */
export const rollAdvantage = () => roll("2d20kh1");

/** Roll with disadvantage (2d20, keep lowest). */
export const rollDisadvantage = () => roll("2d20kl1");

/**
 * Calculate ability modifier from a score.
 * @param {number} score
 * @returns {number}
 */
export const abilityMod = (score) => Math.floor((score - 10) / 2);

/**
 * Check if a roll meets a Difficulty Class.
 * @param {RollResult} result
 * @param {number} dc
 * @returns {{ success: boolean, margin: number }}
 */
export function checkDC(result, dc) {
  return {
    success: result.total >= dc,
    margin: result.total - dc,
  };
}

// ── JSDoc Types ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ParsedNotation
 * @property {number} count
 * @property {number} sides
 * @property {number} modifier
 * @property {'high'|'low'|null} keep
 * @property {number|null} keepCount
 */

/**
 * @typedef {Object} RollResult
 * @property {string} notation
 * @property {number[]} dice
 * @property {number[]} used
 * @property {number[]} dropped
 * @property {number} modifier
 * @property {number} subtotal
 * @property {number} total
 * @property {number} timestamp
 * @property {boolean} [critical]
 */
