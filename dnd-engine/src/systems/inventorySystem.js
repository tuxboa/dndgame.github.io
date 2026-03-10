/**
 * inventorySystem.js
 *
 * List-based stacking inventory with bartering support.
 * Items are [{ itemId, name, quantity, equipped, description, value }]
 * Identical itemIds stack automatically.
 *
 * Trade system: propose → counterparty accepts/rejects → items transfer.
 * In multiplayer: propose/accept go through NetworkBridge so both sides sync.
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { equipItem, unequipItem, isEquippable } from "./equipmentSystem.js";
import { roll } from "./diceSystem.js";

// ── Item Operations ───────────────────────────────────────────────────────────

/**
 * Add item(s) to the player's inventory.
 * Stacks if itemId already exists.
 *
 * @param {{ itemId: string, name: string, quantity?: number, description?: string, value?: number }} item
 */
export function addItem(item) {
  const state = gameStore.getState();
  const inventory = [...state.player.inventory];
  const idx = inventory.findIndex((i) => i.itemId === item.itemId);

  if (idx !== -1) {
    inventory[idx] = {
      ...inventory[idx],
      quantity: inventory[idx].quantity + (item.quantity ?? 1),
    };
  } else {
    inventory.push({ equipped: false, quantity: 1, ...item });
  }

  gameStore.setState(
    {
      player: { ...state.player, inventory },
    },
    "inventorySystem:addItem",
  );

  eventBus.emit(EVENTS.INVENTORY_CHANGED, { action: "add", item });
}

/**
 * Remove a quantity of an item from inventory.
 * If quantity reaches 0 the item entry is removed.
 *
 * @param {string} itemId
 * @param {number} [quantity=1]
 * @returns {boolean} true if successful
 */
export function removeItem(itemId, quantity = 1) {
  let state = gameStore.getState();
  let inventory = [...state.player.inventory];
  let idx = inventory.findIndex((i) => i.itemId === itemId);

  if (idx === -1 || inventory[idx].quantity < quantity) return false;

  // If the item is equipped, unequip it first so stats and equipment slots stay in sync.
  // Re-read state afterward because unequipItem calls setState (recalculates stats, clears slot).
  if (inventory[idx].equipped && isEquippable(itemId)) {
    unequipItem(itemId);
    state = gameStore.getState();
    inventory = [...state.player.inventory];
    idx = inventory.findIndex((i) => i.itemId === itemId);
    if (idx === -1) return false; // Shouldn't happen, but guard anyway
  }

  if (inventory[idx].quantity === quantity) {
    inventory.splice(idx, 1);
  } else {
    inventory[idx] = {
      ...inventory[idx],
      quantity: inventory[idx].quantity - quantity,
    };
  }

  gameStore.setState(
    {
      player: { ...state.player, inventory },
    },
    "inventorySystem:removeItem",
  );

  eventBus.emit(EVENTS.INVENTORY_CHANGED, {
    action: "remove",
    itemId,
    quantity,
  });
  return true;
}

/**
 * Toggle equipped state for a given item.
 * Delegates to equipItem / unequipItem from equipmentSystem so that
 * stat bonuses and equipment slots are correctly applied/removed.
 * @param {string} itemId
 */
export function toggleEquip(itemId) {
  const state = gameStore.getState();
  const item = state.player.inventory.find((i) => i.itemId === itemId);
  if (!item) return;

  if (isEquippable(itemId)) {
    // Use the equipment system so bonuses and slots are properly handled
    if (item.equipped) {
      unequipItem(itemId);
    } else {
      equipItem(itemId);
    }
  } else {
    // Non-equippable items: just flip the flag (legacy / cosmetic)
    const inventory = state.player.inventory.map((i) =>
      i.itemId === itemId ? { ...i, equipped: !i.equipped } : i,
    );
    gameStore.setState(
      { player: { ...state.player, inventory } },
      "inventorySystem:toggleEquip",
    );
  }

  eventBus.emit(EVENTS.INVENTORY_CHANGED, { action: "equip", itemId });
}

/**
 * Use a consumable item (potions, scrolls, etc.).
 * NOTE: Use useItem() from actionDispatcher.js for the game-integrated version.
 * Reads item.healDice or item.healNotation; heals the player and removes 1
 * from the stack.
 *
 * @param {string} itemId
 * @returns {boolean} true if the item was used successfully
 */
function useItem(itemId) {
  const state = gameStore.getState();
  const item = state.player.inventory.find((i) => i.itemId === itemId);
  if (!item) return false;

  const healNotation = item.healDice ?? item.healNotation;
  if (!healNotation) {
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: `${item.name} cannot be used directly.`,
      type: "info",
      ttl: 2000,
    });
    return false;
  }

  const healRoll = roll(healNotation);
  const healed = healRoll.total;
  const p = gameStore.getState().player;
  const newHp = Math.min(p.maxHp ?? p.hp, (p.hp ?? 0) + healed);

  // Sync HP into combat turn order if combat is active
  const combat = gameStore.getState().combat;
  const combatPatch = combat.active
    ? {
        combat: {
          ...combat,
          turnOrder: combat.turnOrder.map((c) =>
            c.isPlayer ? { ...c, hp: newHp } : c,
          ),
        },
      }
    : {};

  gameStore.setState(
    { player: { ...p, hp: newHp }, ...combatPatch },
    "inventorySystem:useItem",
  );

  removeItem(itemId, 1);

  eventBus.emit(EVENTS.UI_NOTIFICATION, {
    text: `🧪 ${item.name}: restored ${healed} HP (${p.hp} → ${newHp})`,
    type: "success",
    ttl: 3000,
  });

  return true;
}

/**
 * Check if player has a specific item (and optional minimum quantity).
 * @param {string} itemId
 * @param {number} [minQuantity=1]
 * @returns {boolean}
 */
export function hasItem(itemId, minQuantity = 1) {
  const inv = gameStore.getState().player.inventory;
  const item = inv.find((i) => i.itemId === itemId);
  return !!(item && item.quantity >= minQuantity);
}

/**
 * Add or subtract gold.
 * @param {number} amount - Positive to add, negative to spend
 * @returns {boolean} false if insufficient funds for a spend
 */
export function modifyGold(amount) {
  const state = gameStore.getState();
  const newGold = state.player.gold + amount;

  if (newGold < 0) return false; // Can't go into debt

  gameStore.setState(
    {
      player: { ...state.player, gold: newGold },
    },
    "inventorySystem:modifyGold",
  );

  return true;
}

// ── Barter / Trade ────────────────────────────────────────────────────────────

/**
 * Propose a trade.
 * In singleplayer this is between the player and an NPC.
 * In co-op this triggers a NetworkBridge broadcast.
 *
 * @param {Object} proposal
 * @param {string} proposal.counterpartyId
 * @param {string} proposal.counterpartyName
 * @param {TradeItem[]} proposal.offeredItems   - What the player gives
 * @param {TradeItem[]} proposal.requestedItems - What the player wants
 */
export function proposeTrade(proposal) {
  // Validate the player actually has the items they're offering
  for (const item of proposal.offeredItems) {
    if (!hasItem(item.itemId, item.quantity)) {
      console.warn(
        `[Inventory] Trade failed: player doesn't have ${item.itemId} x${item.quantity}`,
      );
      return false;
    }
  }

  gameStore.setState(
    {
      trade: {
        active: true,
        counterpartyId: proposal.counterpartyId,
        counterpartyName: proposal.counterpartyName,
        offeredItems: proposal.offeredItems,
        requestedItems: proposal.requestedItems,
        status: "pending",
      },
    },
    "inventorySystem:proposeTrade",
  );

  eventBus.emit(EVENTS.TRADE_PROPOSED, proposal);
  return true;
}

/**
 * Accept the current pending trade.
 * Transfers items in both directions.
 */
export function acceptTrade() {
  const trade = gameStore.getState().trade;
  if (!trade.active || trade.status !== "pending") return;

  // Remove offered items from player
  trade.offeredItems.forEach((item) => removeItem(item.itemId, item.quantity));

  // Add requested items to player
  trade.requestedItems.forEach((item) => addItem(item));

  gameStore.setState(
    {
      trade: {
        active: false,
        counterpartyId: null,
        counterpartyName: "",
        offeredItems: [],
        requestedItems: [],
        status: "accepted",
      },
    },
    "inventorySystem:acceptTrade",
  );

  eventBus.emit(EVENTS.TRADE_ACCEPTED, { trade });
}

/**
 * Cancel or reject the current pending trade.
 */
export function cancelTrade() {
  gameStore.setState(
    {
      trade: {
        active: false,
        counterpartyId: null,
        counterpartyName: "",
        offeredItems: [],
        requestedItems: [],
        status: null,
      },
    },
    "inventorySystem:cancelTrade",
  );

  eventBus.emit(EVENTS.TRADE_CANCELLED, {});
}

/**
 * @typedef {{ itemId: string, name: string, quantity: number }} TradeItem
 */
