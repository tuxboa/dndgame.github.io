/**
 * actionDispatcher.js — The sole gate for all player actions.
 *
 * RESPONSIBILITIES:
 *   1. Validate actions (is it the player's turn? is the action legal?)
 *   2. Route to the correct system (dice, combat, DM, inventory)
 *   3. Provide the NetworkAdapter seam — swap LocalAdapter for WebSocketAdapter
 *      to go from singleplayer to multiplayer without touching any other file
 *
 * Every player-initiated action flows through here.
 * Systems and UI never call each other directly.
 *
 * MULTIPLAYER SEAM:
 *   In singleplayer: actions are resolved locally, result dispatched immediately
 *   In co-op:        actions are sent to the server, server sends back result,
 *                    NetworkBridge emits the result event, dispatcher applies it
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { roll, checkDC } from "../systems/diceSystem.js";
import { promptRollAndAnimate } from "../ui/components/DiceRollerUI.js";
import {
  startCombat,
  advanceTurn,
  logCombatAction,
  applyDamage,
} from "../systems/turnManager.js";
import { removeItem, addItem } from "../systems/inventorySystem.js";
import { addXp } from "../systems/levelUpSystem.js";
import { processTurn } from "../systems/dmController.js";

// ── Network Adapter ───────────────────────────────────────────────────────────

// LocalAdapter (singleplayer / offline — swap NetworkAdapter below to re-enable):
//   requestRoll(notation) { return Promise.resolve(roll(notation)); }

/**
 * ManualRollAdapter — pauses the action and shows a "Roll!" button.
 * The player physically clicks to roll; only then does the game proceed.
 * Enemy rolls (in combatManager.js) stay automatic.
 */
const ManualRollAdapter = {
  /**
   * Show the dice canvas prompt and resolve with the result after
   * the 3D animation finishes.
   *
   * @param {string} notation - Dice notation, e.g. '1d20+3'
   * @param {string} [label]  - Human-readable purpose, e.g. 'Attack Roll'
   * @returns {Promise<RollResult>}
   */
  requestRoll(notation, label = "Roll Dice") {
    return promptRollAndAnimate(notation, label);
  },
};

// /**
//  * WebSocketAdapter — swap LocalAdapter for this in co-op mode.
//  * networkBridge.js handles the WS connection; this is just the interface.
//  */
// const WebSocketAdapter = {
//   requestRoll(notation) {
//     return new Promise((resolve) => {
//       const id = crypto.randomUUID();
//       eventBus.once(`roll:result:${id}`, resolve);
//       networkBridge.send({ type: 'ROLL_REQUEST', notation, id });
//     });
//   }
// };

// Active adapter — change this one line to switch modes
const NetworkAdapter = ManualRollAdapter;

// ── Initialisation ────────────────────────────────────────────────────────────

/** Timestamp until which COMBAT_REQUESTED events are suppressed (post-combat cooldown). */
let _combatCooldownUntil = 0;

/**
 * Wire up engine-level event listeners.
 * Call once during bootstrap — before any combat can happen.
 */
export function initDispatcher() {
  // Set a 3-second cooldown after combat ends to prevent AI-triggered re-combat
  eventBus.on(EVENTS.COMBAT_ENDED, () => {
    _combatCooldownUntil = Date.now() + 3000;
    console.log("[Dispatcher] Combat ended — AI combat suppressed for 3s");
  });

  // Translate the DM's combat request into a real turn-ordered encounter.
  eventBus.on(EVENTS.COMBAT_REQUESTED, (trigger) => {
    console.log(
      "[Dispatcher] COMBAT_REQUESTED received:",
      JSON.stringify(trigger),
    );
    try {
      const state = gameStore.getState();

      // Skip if a combat is already running to prevent double-starts
      if (state.combat.active) {
        console.warn(
          "[Dispatcher] COMBAT_REQUESTED ignored — combat already active",
        );
        return;
      }

      // Skip if in post-combat cooldown (prevents AI from re-triggering combat immediately)
      if (Date.now() < _combatCooldownUntil) {
        console.warn(
          "[Dispatcher] COMBAT_REQUESTED suppressed — post-combat cooldown",
        );
        return;
      }

      const enemyTemplates = state.campaign.enemies ?? {};
      const player = state.player;

      // Ensure player HP ≥ 1 before starting combat
      const playerHp = (player.hp ?? 0) > 0 ? player.hp : 1;
      if (playerHp !== player.hp) {
        gameStore.setState(
          { player: { ...player, hp: 1 } },
          "dispatcher:ensureHp",
        );
      }

      // Build the player participant
      const playerParticipant = {
        id: player.id ?? "player",
        name: player.name,
        isPlayer: true,
        hp: playerHp,
        maxHp: player.maxHp || playerHp,
        ac: player.ac,
        initiativeModifier: Math.floor(
          ((player.abilities?.dex ?? 10) - 10) / 2,
        ),
      };

      // Expand each enemy type × count into individual participants
      const enemies = [];
      const incoming = Array.isArray(trigger?.enemies) ? trigger.enemies : [];

      if (incoming.length === 0) {
        console.warn(
          "[Dispatcher] COMBAT_REQUESTED trigger has no enemies array:",
          trigger,
        );
      }

      incoming.forEach(({ type, count = 1 }) => {
        if (!type || typeof type !== "string") {
          console.warn(
            "[Dispatcher] Enemy entry missing valid type — skipping:",
            { type, count },
          );
          return;
        }
        const tpl = enemyTemplates[type];
        if (!tpl) {
          console.warn(
            `[Dispatcher] Unknown enemy type: "${type}" — using generic fallback`,
          );
        }
        // Use the template if found, otherwise build a sensible generic enemy
        const resolved = tpl ?? {
          name: type
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
          baseHp: 12,
          baseDmg: 4,
          damageDie: "1d6",
          ac: 12,
          attackBonus: 2,
          xpReward: 50,
          goldReward: 0,
          lootTable: [],
        };
        for (let i = 0; i < count; i++) {
          enemies.push({
            id: `${type}_${Date.now()}_${i}`,
            name: count > 1 ? `${resolved.name} ${i + 1}` : resolved.name,
            isPlayer: false,
            enemyType: type,
            hp: resolved.baseHp,
            maxHp: resolved.baseHp,
            ac: resolved.ac ?? 12,
            attackBonus: resolved.attackBonus ?? 2,
            damageDie: resolved.damageDie ?? "1d6",
            baseDmg: resolved.baseDmg ?? 0,
            xpReward: resolved.xpReward ?? 0,
            goldReward: resolved.goldReward ?? 0,
            lootTable: resolved.lootTable ?? [],
            // Range system — 1 = melee (adjacent square), higher = can attack from distance
            weaponRange: resolved.weaponRange ?? 1,
            movementSpeed: resolved.movementSpeed ?? 30,
            initiativeModifier: Math.floor(((resolved.dex ?? 10) - 10) / 2),
          });
        }
      });

      if (enemies.length === 0) {
        console.warn(
          "[Dispatcher] combatTrigger had no valid enemies — ignoring.",
        );
        return;
      }

      console.log(
        `[Dispatcher] Starting combat with ${enemies.length} enemy/enemies.`,
      );
      startCombat([playerParticipant, ...enemies]);
    } catch (err) {
      console.error("[Dispatcher] COMBAT_REQUESTED handler crashed:", err);
    }
  });
}

/**
 * Player sends a free-text action to the DM.
 * Main driver of the narrative game loop.
 *
 * @param {string} text
 */
export async function submitNarrativeAction(text) {
  if (!_canAct()) return;
  await processTurn(text);
}

/**
 * Perform an attack action in combat.
 *
 * @param {string} attackerId
 * @param {string} targetId
 * @param {{ notation: string, attackBonus: number, damageNotation: string, damageName: string, disadvantage?: boolean }} weapon
 */
export async function performAttack(attackerId, targetId, weapon) {
  if (!_canAct()) return;

  const state = gameStore.getState();
  const target = state.combat.turnOrder.find((p) => p.id === targetId);

  if (!target) {
    console.warn(
      `[Dispatcher] Attack target ${targetId} not found in turn order`,
    );
    return;
  }

  // ── Step 1: Roll to-hit (d20 + attack bonus); disadvantage = 2d20 take lower)
  const _atkBonus = weapon.attackBonus ?? 0;
  const signStr = _atkBonus >= 0 ? `+${_atkBonus}` : `${_atkBonus}`;

  // Auto-disadvantage from conditions on the attacker (frightened / blinded / prone)
  let autoDisadvantage = weapon.disadvantage ?? false;
  if (!autoDisadvantage) {
    const attackerCombatant = state.combat.turnOrder.find(
      (p) => p.id === attackerId,
    );
    const activeEffects = attackerCombatant?.activeEffects ?? [];
    if (
      activeEffects.some(
        (e) => e.id === "frightened" || e.id === "blinded" || e.id === "prone",
      )
    ) {
      autoDisadvantage = true;
    }
  }

  // Auto-advantage when the TARGET is blinded or prone (D&D 5e)
  let autoAdvantage = false;
  {
    const targetCombatant = state.combat.turnOrder.find(
      (p) => p.id === targetId,
    );
    const targetEffects = targetCombatant?.activeEffects ?? [];
    if (targetEffects.some((e) => e.id === "blinded" || e.id === "prone")) {
      autoAdvantage = true;
    }
  }

  // Advantage and disadvantage cancel each other (D&D 5e rule)
  const netAdvantage = autoAdvantage && !autoDisadvantage;
  const netDisadvantage = autoDisadvantage && !autoAdvantage;

  const rollNotation = netDisadvantage
    ? `2d20kl1${signStr}`
    : netAdvantage
      ? `2d20kh1${signStr}`
      : _atkBonus >= 0
        ? `1d20+${_atkBonus}`
        : `1d20-${Math.abs(_atkBonus)}`;
  const attackRoll = await NetworkAdapter.requestRoll(
    rollNotation,
    netDisadvantage
      ? `⚠️ Disadvantage Attack — ${target.name}`
      : netAdvantage
        ? `✨ Advantage Attack — ${target.name}`
        : `Attack Roll — ${target.name}`,
  );

  // Use the KEPT die (used[0]) so a dropped nat-20 on disadvantage roll
  // does not falsely trigger a critical hit.
  const usedDie = attackRoll.used?.[0] ?? attackRoll.dice[0];
  const hit = usedDie === 20 || attackRoll.total >= target.ac;
  const crit = usedDie === 20;

  if (!hit) {
    logCombatAction({
      actor: attackerId,
      action: `attacked ${target.name}`,
      result: `Miss (rolled ${attackRoll.total} vs AC ${target.ac})`,
    });
    eventBus.emit(EVENTS.COMBAT_MISS, {
      attacker: attackerId,
      target: targetId,
      roll: attackRoll,
    });
    if (!weapon.skipTurnAdvance) advanceTurn();
    return;
  }

  // ── Step 2: Roll damage
  const baseDmgNotation = weapon.damageNotation ?? "1d4";
  // On a crit, double the dice (D&D 5e rule)
  const critDmgNotation = baseDmgNotation.replace(
    /^(\d+)d(\d+)/,
    (_, n, d) => `${parseInt(n) * 2}d${d}`,
  );
  const dmgNotationToRoll = crit ? critDmgNotation : baseDmgNotation;
  const damageRoll = await NetworkAdapter.requestRoll(
    dmgNotationToRoll,
    crit
      ? `⚡ CRIT Damage — ${weapon.damageName ?? "weapon"}`
      : `Damage — ${weapon.damageName ?? "weapon"}`,
  );
  const damage = damageRoll.total;

  applyDamage(targetId, damage);

  logCombatAction({
    actor: attackerId,
    action: `attacked ${target.name} with ${weapon.damageName ?? "weapon"}`,
    result: `${crit ? "💥 CRIT! " : ""}Hit for ${damage} damage`,
  });

  eventBus.emit(EVENTS.COMBAT_HIT, {
    attacker: attackerId,
    target: targetId,
    damage,
    crit,
  });
  if (!weapon.skipTurnAdvance) advanceTurn();
}

/**
 * Perform a skill check.
 *
 * @param {string} skillKey    - e.g. 'athletics', 'stealth'
 * @param {number} dc          - Difficulty class
 * @param {string} [advantage] - 'advantage' | 'disadvantage' | null
 */
export async function performSkillCheck(skillKey, dc, advantage = null) {
  if (!_canAct()) return;

  const state = gameStore.getState();
  const player = state.player;
  const skill = player.skills[skillKey] ?? { proficient: false };
  const abilityScore = _getSkillAbilityScore(skillKey, player);
  const mod =
    Math.floor((abilityScore - 10) / 2) +
    (skill.proficient ? player.proficiencyBonus : 0) +
    (skill.expertise ? player.proficiencyBonus : 0);

  const sign = mod >= 0 ? "+" : "-";
  const absMod = Math.abs(mod);
  const notation =
    advantage === "advantage"
      ? `2d20kh1${sign}${absMod}`
      : advantage === "disadvantage"
        ? `2d20kl1${sign}${absMod}`
        : `1d20${sign}${absMod}`;

  const skillLabel = skillKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const result = await NetworkAdapter.requestRoll(
    notation,
    `${skillLabel} Check (DC ${dc})`,
  );

  const check = checkDC(result, dc);
  return { ...check, result, skillKey, dc };
}

/**
 * Use a consumable item from inventory.
 *
 * @param {string} itemId
 */
export function useItem(itemId) {
  const state = gameStore.getState();
  const item = state.player.inventory.find((i) => i.itemId === itemId);
  if (!item) return;

  // Potions — match common ID patterns: potion_health, health_potion, loot_health_potion,
  // healing_potion, elixir, etc. Also fall back to the item's display name.
  const idLower = item.itemId.toLowerCase();
  const nameLower = (item.name ?? "").toLowerCase();
  const isHealingPotion =
    idLower.includes("potion") ||
    idLower.includes("healing") ||
    idLower.includes("elixir") ||
    nameLower.includes("potion") ||
    nameLower.includes("healing") ||
    nameLower.includes("elixir");
  // Drinks (ale, mead, brew, etc.) — small restorative
  const isDrink =
    !isHealingPotion &&
    (idLower.includes("ale") ||
      idLower.includes("brew") ||
      idLower.includes("mead") ||
      nameLower.includes("ale") ||
      nameLower.includes("brew") ||
      nameLower.includes("mead"));
  if (isHealingPotion || isDrink) {
    const healDice = isHealingPotion
      ? (item.healDice ?? "2d4+2")
      : (item.healDice ?? "1d4");
    const healRoll = roll(healDice);
    const newHp = Math.min(
      state.player.maxHp,
      state.player.hp + healRoll.total,
    );

    // Sync healed HP into combat.turnOrder as well so the HP bar stays accurate
    const combatState = gameStore.getState().combat;
    const turnOrderPatch = combatState.active
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
      {
        player: { ...state.player, hp: newHp },
        ...turnOrderPatch,
      },
      "dispatcher:useItem",
    );

    removeItem(itemId, 1);

    eventBus.emit(EVENTS.DICE_ANIMATE, {
      notation: healDice,
      result: healRoll,
    });
    console.log(
      `[Dispatcher] Used ${item.name} — restored ${healRoll.total} HP. Now at ${newHp}/${state.player.maxHp}`,
    );
    return;
  }

  console.warn(`[Dispatcher] No use behaviour defined for item: ${itemId}`);
}

/**
 * Collect and apply all rewards for a completed victory.
 * Handles both lootTable formats:
 *   - plain string:             "Iron Sword"            (33 % drop chance)
 *   - object: { item, chance?, quantity? }             (explicit chance)
 *
 * Updates player XP, gold, level and inventory in one state patch.
 * Returns a summary object for the Victory modal to display.
 *
 * @param {import('../systems/turnManager.js').CombatParticipant[]} defeatedEnemies
 * @returns {{ xp: number, gold: number, items: string[], leveledUp: boolean, newLevel: number }}
 */
export function collectVictoryRewards(defeatedEnemies) {
  const state = gameStore.getState();
  let totalXp = 0;
  let totalGold = 0;
  const droppedItems = [];

  defeatedEnemies.forEach((enemy) => {
    totalXp += enemy.xpReward ?? 0;
    totalGold += enemy.goldReward ?? 0;

    (enemy.lootTable ?? []).forEach((entry) => {
      // Accept both plain strings and { item, chance, quantity } objects
      const itemName = typeof entry === "string" ? entry : entry.item;
      const chance = typeof entry === "string" ? 0.33 : (entry.chance ?? 0.33);
      const qty = typeof entry === "string" ? 1 : (entry.quantity ?? 1);
      if (Math.random() < chance) {
        droppedItems.push({ name: itemName, quantity: qty });
      }
    });
  });

  const oldLevel = state.player.level ?? 1;
  const newGold = (state.player.gold ?? 0) + totalGold;

  // Apply gold
  gameStore.setState(
    { player: { ...state.player, gold: newGold } },
    "dispatcher:victoryGold",
  );

  // Apply XP via levelUpSystem — this fires LEVEL_UP_READY if a threshold is crossed
  if (totalXp > 0) addXp(totalXp);

  droppedItems.forEach((item) => {
    // Normalize to the same snake_case format _resolveTemplate uses so that
    // apostrophes and other punctuation never break equipment lookups.
    // e.g. "Sergeant's Signet Ring" → "sergeant_s_signet_ring"
    const itemId = item.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    addItem({ itemId, name: item.name, quantity: item.quantity });
  });

  console.log(
    `[Dispatcher] Victory rewards — +${totalXp} XP, +${totalGold} gp,`,
    droppedItems.map((i) => i.name),
  );

  // Re-read XP state after addXp may have updated it
  const afterState = gameStore.getState().player;
  const wouldLevelUp = (afterState.xp ?? 0) >= oldLevel * 100;

  return {
    xp: totalXp,
    gold: totalGold,
    items: droppedItems.map((i) =>
      i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name,
    ),
    leveledUp: wouldLevelUp,
    newLevel: wouldLevelUp ? oldLevel + 1 : oldLevel,
  };
}

// ── Guards ────────────────────────────────────────────────────────────────────

/**
 * Returns true if the local player is allowed to act right now.
 * In solo mode: always true outside combat, true when it's player's turn in combat.
 * In co-op: also checks session.isMyTurn.
 */
function _canAct() {
  const { combat, session } = gameStore.getState();

  if (combat.active && !session.isMyTurn) {
    console.warn("[Dispatcher] Not your turn.");
    return false;
  }

  return true;
}

// Skill → ability mapping (D&D 5e standard)
const SKILL_ABILITIES = {
  athletics: "str",
  acrobatics: "dex",
  sleightOfHand: "dex",
  stealth: "dex",
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",
  animalHandling: "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};

function _getSkillAbilityScore(skillKey, player) {
  const ability = SKILL_ABILITIES[skillKey] ?? "dex";
  return player.abilities[ability] ?? 10;
}
