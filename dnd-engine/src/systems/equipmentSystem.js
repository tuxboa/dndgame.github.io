/**
 * equipmentSystem.js — Equipment slot management and stat recalculation.
 *
 * PUBLIC API
 * ──────────────────────────────────────────────────────────────────
 *  initEquipment()          Snapshot the player's "naked" base stats so we
 *                           can cleanly add / remove bonus deltas.  Safe to
 *                           call multiple times (no-ops after first call).
 *
 *  equipItem(itemId)        Put an item into its slot. Automatically unequips
 *                           whatever was in that slot before. Recalculates all
 *                           affected stats via recomputeStats().
 *
 *  unequipItem(itemId)      Clear the slot that holds this item. Recalculates.
 *
 *  isEquippable(itemId)     Returns the EquipmentTemplate if the item exists
 *                           in EQUIPMENT_TEMPLATES, otherwise false.
 *
 *  getEquippedInSlot(slot)  Returns the EquipmentTemplate for the item
 *                           currently in that slot, or null.
 *
 * HOW STATS WORK
 * ──────────────────────────────────────────────────────────────────
 * On init we snapshot player.ac → player.baseAc, player.maxHp →
 * player.baseMaxHp, player.maxMana → player.baseMaxMana.
 *
 * On every equip / unequip we sum ALL equipment bonuses from scratch and
 * write derived stats back:
 *   player.ac         = baseAc         + Σ acBonus
 *   player.attackBonus= 0              + Σ attackBonus
 *   player.maxHp      = baseMaxHp      + Σ hpBonus
 *   player.maxMana    = baseMaxMana    + Σ manaBonus
 *
 * Current hp / mana are clamped to the new maximums and bumped up by the
 * delta when a bonus increases the ceiling (equipping gives you HP/MP).
 *
 * EVENTS EMITTED
 * ──────────────────────────────────────────────────────────────────
 *  ITEM_EQUIPPED   { itemId, slot, template, bonuses }
 *  ITEM_UNEQUIPPED { itemId, slot }
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { EQUIPMENT_TEMPLATES } from "../data/equipment.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Snapshot base stats (ac, maxHp, maxMana) so bonuses can be
 * cleanly added and removed. Safe to call after every load / creation.
 */
export function initEquipment() {
  const state = gameStore.getState();
  const p = state.player;

  // Already initialised (base stats stored)
  if (p.baseAc != null) return;

  const patch = {
    ...p,
    baseAc: p.ac,
    baseMaxHp: p.maxHp,
    baseMaxMana: p.maxMana ?? 0,
    attackBonus: p.attackBonus ?? 0,
    equipment: p.equipment ?? {
      weapon: null,
      armor: null,
      accessory: null,
      offhand: null,
    },
  };

  // If the player was loaded from a save that already has items equipped,
  // re-apply their bonuses correctly.
  const recomputed = _recomputeStats(patch);

  gameStore.setState({ player: recomputed }, "equipmentSystem:init");
  console.log(
    `[EquipmentSystem] Initialised. Base AC=${patch.baseAc} HP=${patch.baseMaxHp} MP=${patch.baseMaxMana}`,
  );
}

/**
 * Resolve an itemId to its EQUIPMENT_TEMPLATES entry.
 * First tries exact key; then falls back to matching on the template's own
 * `name` field normalised to snake_case — so "Short Sword" → "short_sword"
 * works even if the template key differs from the item's runtime id.
 *
 * @param {string} itemId
 * @returns {object|undefined}
 */
function _resolveTemplate(itemId) {
  if (EQUIPMENT_TEMPLATES[itemId]) return EQUIPMENT_TEMPLATES[itemId];
  const normalised = itemId.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return Object.values(EQUIPMENT_TEMPLATES).find(
    (t) => t.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") === normalised,
  );
}

/**
 * Equip an item by itemId.
 * Silently ignores non-equippable items (not in EQUIPMENT_TEMPLATES).
 *
 * @param {string} itemId
 * @returns {{ ok: boolean, reason?: string }}
 */
export function equipItem(itemId) {
  const template = _resolveTemplate(itemId);
  if (!template) return { ok: false, reason: `"${itemId}" is not equippable` };

  const state = gameStore.getState();
  if (!state.player.inventory.find((i) => i.itemId === itemId)) {
    return { ok: false, reason: "Item not in inventory" };
  }

  const { slot } = template;
  let player = _clone(state.player);

  // ── Unequip whatever is currently in the target slot (if anything) ────────
  const currentInSlot = player.equipment?.[slot];
  if (currentInSlot) {
    player.inventory = player.inventory.map((i) =>
      i.itemId === currentInSlot.itemId ? { ...i, equipped: false } : i,
    );
    player.equipment = { ...player.equipment, [slot]: null };
  }

  // ── Put new item in slot ──────────────────────────────────────────────────
  player.inventory = player.inventory.map((i) =>
    i.itemId === itemId ? { ...i, equipped: true } : i,
  );
  player.equipment = {
    ...(player.equipment ?? {}),
    [slot]: { itemId, name: template.name },
  };

  // ── Recalculate all stat bonuses ──────────────────────────────────────────
  const oldMaxHp = player.maxHp;
  const oldMaxMana = player.maxMana ?? 0;
  player = _recomputeStats(player);

  // Bump current hp/mana when ceiling rises (equipping gives you HP/MP)
  if (player.maxHp > oldMaxHp) {
    player.hp = Math.min(player.maxHp, player.hp + (player.maxHp - oldMaxHp));
  }
  if ((player.maxMana ?? 0) > oldMaxMana) {
    player.mana = Math.min(
      player.maxMana,
      (player.mana ?? 0) + (player.maxMana - oldMaxMana),
    );
  }

  gameStore.setState({ player }, "equipmentSystem:equip");
  eventBus.emit(EVENTS.ITEM_EQUIPPED, {
    itemId,
    slot,
    template,
    bonuses: template.bonuses,
    replacedId: currentInSlot?.itemId ?? null,
  });

  console.log(
    `[EquipmentSystem] Equipped "${template.name}" in [${slot}]. New AC=${player.ac} ATK+${player.attackBonus}`,
  );
  return { ok: true };
}

/**
 * Unequip an item by itemId (regardless of which slot it is in).
 *
 * @param {string} itemId
 * @returns {{ ok: boolean, reason?: string }}
 */
export function unequipItem(itemId) {
  const state = gameStore.getState();
  const equipment = state.player.equipment ?? {};

  const slot = Object.entries(equipment).find(
    ([, v]) => v?.itemId === itemId,
  )?.[0];

  if (!slot) return { ok: false, reason: "Item is not equipped" };

  let player = _clone(state.player);

  player.inventory = player.inventory.map((i) =>
    i.itemId === itemId ? { ...i, equipped: false } : i,
  );
  player.equipment = { ...player.equipment, [slot]: null };

  const oldMaxHp = player.maxHp;
  const oldMaxMana = player.maxMana ?? 0;
  player = _recomputeStats(player);

  // Clamp hp/mana down when ceiling drops (can't exceed new max)
  if (player.maxHp < oldMaxHp) {
    player.hp = Math.min(player.hp, player.maxHp);
  }
  if ((player.maxMana ?? 0) < oldMaxMana) {
    player.mana = Math.min(player.mana ?? 0, player.maxMana ?? 0);
  }

  gameStore.setState({ player }, "equipmentSystem:unequip");
  eventBus.emit(EVENTS.ITEM_UNEQUIPPED, { itemId, slot });

  console.log(
    `[EquipmentSystem] Unequipped "${itemId}" from [${slot}]. New AC=${player.ac}`,
  );
  return { ok: true };
}

/**
 * Returns the EquipmentTemplate if itemId is equippable, otherwise null.
 * @param {string} itemId
 */
export function isEquippable(itemId) {
  return _resolveTemplate(itemId) || false;
}

/**
 * Returns the EquipmentTemplate for whatever is equipped in a given slot.
 * @param {"weapon"|"armor"|"accessory"} slot
 */
export function getEquippedInSlot(slot) {
  const equip = gameStore.getState().player.equipment ?? {};
  const entry = equip[slot];
  return entry ? (EQUIPMENT_TEMPLATES[entry.itemId] ?? null) : null;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Sum all bonus fields from currently equipped items.
 * Pure function — no store access.
 */
function _sumBonuses(equipment) {
  const result = { acBonus: 0, attackBonus: 0, manaBonus: 0, hpBonus: 0 };
  Object.values(equipment ?? {}).forEach((slotItem) => {
    if (!slotItem) return;
    const tpl = _resolveTemplate(slotItem.itemId);
    if (!tpl) return;
    result.acBonus += tpl.bonuses.acBonus ?? 0;
    result.attackBonus += tpl.bonuses.attackBonus ?? 0;
    result.manaBonus += tpl.bonuses.manaBonus ?? 0;
    result.hpBonus += tpl.bonuses.hpBonus ?? 0;
  });
  return result;
}

/**
 * Recompute all equipment-derived stats from base values.
 * Pure function — takes a player object, returns a NEW player object.
 * Does NOT adjust current hp/mana — callers handle that.
 */
function _recomputeStats(player) {
  const bonuses = _sumBonuses(player.equipment);
  return {
    ...player,
    ac: (player.baseAc ?? player.ac) + bonuses.acBonus,
    attackBonus: bonuses.attackBonus,
    maxHp: (player.baseMaxHp ?? player.maxHp) + bonuses.hpBonus,
    maxMana: (player.baseMaxMana ?? player.maxMana ?? 0) + bonuses.manaBonus,
  };
}

/** Shallow-clone a player object (inventory + equipment arrays need separate clone) */
function _clone(player) {
  return {
    ...player,
    inventory: [...player.inventory],
    equipment: { ...(player.equipment ?? {}) },
  };
}
