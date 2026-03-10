/**
 * equipment.js — Static equippable item templates.
 *
 * Each key matches an itemId used in the inventory system.
 * When an item in inventory has a matching key here it is treated as
 * equippable rather than consumable.
 *
 * EquipmentTemplate shape:
 *   id          — must match the object key + itemId in inventory
 *   name        — display name
 *   icon        — emoji used in slot display
 *   slot        — "weapon" | "armor" | "accessory"
 *   description — short one-liner shown in the inventory row
 *   bonuses     — stat deltas applied on equip, removed on unequip:
 *     attackBonus  → added to player.attackBonus (used for all attack rolls)
 *     damageDie    → maximum die for weapon damage (1dX), e.g. 8 → 1d8
 *     finesse      → if true, attack/damage use DEX instead of STR when higher
 *     acBonus      → added to player.ac
 *     manaBonus    → added to player.maxMana (current mana also increases)
 *     hpBonus      → added to player.maxHp  (current hp also increases)
 */

/** @type {Record<string, EquipmentTemplate>} */
export const EQUIPMENT_TEMPLATES = {
  // ── Weapons ───────────────────────────────────────────────────────────────

  iron_sword: {
    id: "iron_sword",
    name: "Iron Sword",
    icon: "⚔️",
    slot: "weapon",
    description: "+2 attack rolls · 1d8 slashing damage",
    bonuses: { attackBonus: 2, damageDie: 8 },
  },

  shortsword: {
    id: "shortsword",
    name: "Shortsword",
    icon: "🗡️",
    slot: "weapon",
    description: "+1 attack · 1d6 piercing · finesse",
    bonuses: { attackBonus: 1, damageDie: 6, finesse: true },
  },

  short_sword: {
    id: "short_sword",
    name: "Short Sword",
    icon: "🗡️",
    slot: "weapon",
    description: "+1 attack · 1d6 piercing · finesse",
    bonuses: { attackBonus: 1, damageDie: 6, finesse: true },
  },

  dagger: {
    id: "dagger",
    name: "Dagger",
    icon: "🔪",
    slot: "weapon",
    description: "+1 attack · 1d4 piercing · finesse · thrown",
    bonuses: { attackBonus: 1, damageDie: 4, finesse: true },
  },

  longsword: {
    id: "longsword",
    name: "Longsword",
    icon: "⚔️",
    slot: "weapon",
    description: "+2 attack · 1d8 slashing",
    bonuses: { attackBonus: 2, damageDie: 8 },
  },

  captains_longsword: {
    id: "captains_longsword",
    name: "Captain's Longsword",
    icon: "⚔️",
    slot: "weapon",
    description: "+3 attack · 1d8+1 slashing · masterwork",
    bonuses: { attackBonus: 3, damageDie: 8, baseDmgBonus: 1 },
  },

  staff_of_sparks: {
    id: "staff_of_sparks",
    name: "Staff of Sparks",
    icon: "🪄",
    slot: "weapon",
    description: "+1 attack · 1d6 bludgeoning · +2 Max MP",
    bonuses: { attackBonus: 1, damageDie: 6, manaBonus: 2 },
  },

  thieves_tools: {
    id: "thieves_tools",
    name: "Thieves' Tools",
    icon: "🔧",
    slot: "weapon",
    description: "+1 attack · 1d4 piercing · finesse",
    bonuses: { attackBonus: 1, damageDie: 4, finesse: true },
  },

  greataxe: {
    id: "greataxe",
    name: "Greataxe",
    icon: "🪓",
    slot: "weapon",
    description: "+2 attack · 1d12 slashing · two-handed",
    bonuses: { attackBonus: 2, damageDie: 12 },
  },

  handaxe: {
    id: "handaxe",
    name: "Handaxe",
    icon: "🪓",
    slot: "weapon",
    description: "+1 attack · 1d6 slashing · thrown",
    bonuses: { attackBonus: 1, damageDie: 6 },
  },

  battleaxe: {
    id: "battleaxe",
    name: "Battleaxe",
    icon: "🪓",
    slot: "weapon",
    description: "+2 attack · 1d8 slashing",
    bonuses: { attackBonus: 2, damageDie: 8 },
  },

  warhammer: {
    id: "warhammer",
    name: "Warhammer",
    icon: "🔨",
    slot: "weapon",
    description: "+2 attack · 1d8 bludgeoning",
    bonuses: { attackBonus: 2, damageDie: 8 },
  },

  mace: {
    id: "mace",
    name: "Mace",
    icon: "🔨",
    slot: "weapon",
    description: "+1 attack · 1d6 bludgeoning",
    bonuses: { attackBonus: 1, damageDie: 6 },
  },

  spear: {
    id: "spear",
    name: "Spear",
    icon: "🗡️",
    slot: "weapon",
    description: "+1 attack · 1d6 piercing · thrown",
    bonuses: { attackBonus: 1, damageDie: 6 },
  },

  rapier: {
    id: "rapier",
    name: "Rapier",
    icon: "🗡️",
    slot: "weapon",
    description: "+2 attack · 1d8 piercing · finesse",
    bonuses: { attackBonus: 2, damageDie: 8, finesse: true },
  },

  flail: {
    id: "flail",
    name: "Flail",
    icon: "⚔️",
    slot: "weapon",
    description: "+2 attack · 1d8 bludgeoning",
    bonuses: { attackBonus: 2, damageDie: 8 },
  },

  quarterstaff: {
    id: "quarterstaff",
    name: "Quarterstaff",
    icon: "🪄",
    slot: "weapon",
    description: "+1 attack · 1d6 bludgeoning",
    bonuses: { attackBonus: 1, damageDie: 6 },
  },

  shortbow: {
    id: "shortbow",
    name: "Shortbow",
    icon: "🏹",
    slot: "weapon",
    description: "+2 attack · 1d6 piercing · ranged 8sq · uses arrows",
    bonuses: {
      attackBonus: 2,
      damageDie: 6,
      weaponRange: 8,
      dexBased: true,
      ranged: true,
      ammoType: "arrow",
    },
  },

  longbow: {
    id: "longbow",
    name: "Longbow",
    icon: "🏹",
    slot: "weapon",
    description: "+2 attack · 1d8 piercing · ranged 12sq · uses arrows",
    bonuses: {
      attackBonus: 2,
      damageDie: 8,
      weaponRange: 12,
      dexBased: true,
      ranged: true,
      ammoType: "arrow",
    },
  },

  light_crossbow: {
    id: "light_crossbow",
    name: "Light Crossbow",
    icon: "🏹",
    slot: "weapon",
    description: "+2 attack · 1d8 piercing · ranged 10sq · uses bolts",
    bonuses: {
      attackBonus: 2,
      damageDie: 8,
      weaponRange: 10,
      dexBased: true,
      ranged: true,
      ammoType: "bolt",
    },
  },

  hand_crossbow: {
    id: "hand_crossbow",
    name: "Hand Crossbow",
    icon: "🏹",
    slot: "weapon",
    description: "+1 attack · 1d6 piercing · ranged 6sq · uses bolts",
    bonuses: {
      attackBonus: 1,
      damageDie: 6,
      weaponRange: 6,
      dexBased: true,
      ranged: true,
      ammoType: "bolt",
    },
  },

  // ── Armor ─────────────────────────────────────────────────────────────────

  leather_armor: {
    id: "leather_armor",
    name: "Leather Armor",
    icon: "🦺",
    slot: "armor",
    description: "+2 AC",
    bonuses: { acBonus: 2 },
  },

  chain_shirt: {
    id: "chain_shirt",
    name: "Chain Shirt",
    icon: "🛡️",
    slot: "armor",
    description: "+3 AC",
    bonuses: { acBonus: 3 },
  },

  chain_mail: {
    id: "chain_mail",
    name: "Chain Mail",
    icon: "🛡️",
    slot: "armor",
    description: "+4 AC",
    bonuses: { acBonus: 4 },
  },

  shield: {
    id: "shield",
    name: "Shield",
    icon: "🛡️",
    slot: "offhand",
    description: "+2 AC · equip alongside armor",
    bonuses: { acBonus: 2 },
  },

  buckler: {
    id: "buckler",
    name: "Buckler",
    icon: "🛡️",
    slot: "offhand",
    description: "+1 AC · light shield",
    bonuses: { acBonus: 1 },
  },

  offhand_dagger: {
    id: "offhand_dagger",
    name: "Dagger (Off-hand)",
    icon: "🔪",
    slot: "offhand",
    description: "+1 attack · 1d4 piercing · finesse · sidearm",
    bonuses: { attackBonus: 1, damageDie: 4, finesse: true },
  },

  offhand_shortsword: {
    id: "offhand_shortsword",
    name: "Shortsword (Off-hand)",
    icon: "🗡️",
    slot: "offhand",
    description: "+1 attack · 1d6 piercing · finesse · sidearm",
    bonuses: { attackBonus: 1, damageDie: 6, finesse: true },
  },

  offhand_handaxe: {
    id: "offhand_handaxe",
    name: "Handaxe (Off-hand)",
    icon: "🪓",
    slot: "offhand",
    description: "+1 attack · 1d6 slashing · sidearm",
    bonuses: { attackBonus: 1, damageDie: 6 },
  },

  padded_armor: {
    id: "padded_armor",
    name: "Padded Armor",
    icon: "🦺",
    slot: "armor",
    description: "+1 AC",
    bonuses: { acBonus: 1 },
  },

  hide_armor: {
    id: "hide_armor",
    name: "Hide Armor",
    icon: "🦺",
    slot: "armor",
    description: "+2 AC",
    bonuses: { acBonus: 2 },
  },

  studded_leather: {
    id: "studded_leather",
    name: "Studded Leather",
    icon: "🦺",
    slot: "armor",
    description: "+3 AC",
    bonuses: { acBonus: 3 },
  },

  scale_mail: {
    id: "scale_mail",
    name: "Scale Mail",
    icon: "🛡️",
    slot: "armor",
    description: "+4 AC",
    bonuses: { acBonus: 4 },
  },

  breastplate: {
    id: "breastplate",
    name: "Breastplate",
    icon: "🛡️",
    slot: "armor",
    description: "+4 AC",
    bonuses: { acBonus: 4 },
  },

  half_plate: {
    id: "half_plate",
    name: "Half Plate",
    icon: "🛡️",
    slot: "armor",
    description: "+5 AC",
    bonuses: { acBonus: 5 },
  },

  splint_mail: {
    id: "splint_mail",
    name: "Splint Mail",
    icon: "🛡️",
    slot: "armor",
    description: "+5 AC",
    bonuses: { acBonus: 5 },
  },

  plate_armor: {
    id: "plate_armor",
    name: "Plate Armor",
    icon: "🛡️",
    slot: "armor",
    description: "+6 AC",
    bonuses: { acBonus: 6 },
  },

  ring_mail: {
    id: "ring_mail",
    name: "Ring Mail",
    icon: "🛡️",
    slot: "armor",
    description: "+3 AC",
    bonuses: { acBonus: 3 },
  },

  full_plate_fragment: {
    id: "full_plate_fragment",
    name: "Full Plate Fragment",
    icon: "⚙️",
    slot: "armor",
    description: "+5 AC · heavy · improvised",
    bonuses: { acBonus: 5 },
  },

  mage_robe: {
    id: "mage_robe",
    name: "Mage's Robe",
    icon: "🥋",
    slot: "armor",
    description: "+1 AC · +5 Max MP",
    bonuses: { acBonus: 1, manaBonus: 5 },
  },

  // ── Accessories ───────────────────────────────────────────────────────────

  ring_of_vitality: {
    id: "ring_of_vitality",
    name: "Ring of Vitality",
    icon: "💍",
    slot: "accessory",
    description: "+5 Max HP",
    bonuses: { hpBonus: 5 },
  },

  amulet_of_focus: {
    id: "amulet_of_focus",
    name: "Amulet of Focus",
    icon: "📿",
    slot: "accessory",
    description: "+8 Max MP",
    bonuses: { manaBonus: 8 },
  },

  arcane_core_shard: {
    id: "arcane_core_shard",
    name: "Arcane Core Shard",
    icon: "🔮",
    slot: "accessory",
    description: "+2 Max MP · +1 attack",
    bonuses: { manaBonus: 2, attackBonus: 1 },
  },

  sergeant_s_signet_ring: {
    id: "sergeant_s_signet_ring",
    name: "Sergeant's Signet Ring",
    icon: "💍",
    slot: "accessory",
    description: "+3 Max HP · +1 attack",
    bonuses: { hpBonus: 3, attackBonus: 1 },
  },

  guard_s_helm: {
    id: "guard_s_helm",
    name: "Guard's Helm",
    icon: "⛑️",
    slot: "accessory",
    description: "+1 AC · +2 Max HP",
    bonuses: { acBonus: 1, hpBonus: 2 },
  },

  arcane_core_fragment: {
    id: "arcane_core_fragment",
    name: "Arcane Core Fragment",
    icon: "🔮",
    slot: "accessory",
    description: "+5 Max MP · +2 attack",
    bonuses: { manaBonus: 5, attackBonus: 2 },
  },

  construct_plating: {
    id: "construct_plating",
    name: "Construct Plating",
    icon: "⚙️",
    slot: "armor",
    description: "+6 AC · salvaged sentinel armor",
    bonuses: { acBonus: 6 },
  },

  cloak_of_protection: {
    id: "cloak_of_protection",
    name: "Cloak of Protection",
    icon: "🧣",
    slot: "accessory",
    description: "+1 AC · +1 Max HP",
    bonuses: { acBonus: 1, hpBonus: 1 },
  },

  amulet_of_health: {
    id: "amulet_of_health",
    name: "Amulet of Health",
    icon: "📿",
    slot: "accessory",
    description: "+8 Max HP",
    bonuses: { hpBonus: 8 },
  },

  gloves_of_archery: {
    id: "gloves_of_archery",
    name: "Gloves of Archery",
    icon: "🧤",
    slot: "accessory",
    description: "+1 attack",
    bonuses: { attackBonus: 1 },
  },

  belt_of_strength: {
    id: "belt_of_strength",
    name: "Belt of Strength",
    icon: "🔰",
    slot: "accessory",
    description: "+2 attack · +3 Max HP",
    bonuses: { attackBonus: 2, hpBonus: 3 },
  },

  war_pendant: {
    id: "war_pendant",
    name: "War Pendant",
    icon: "📿",
    slot: "accessory",
    description: "+2 attack",
    bonuses: { attackBonus: 2 },
  },

  iron_band: {
    id: "iron_band",
    name: "Iron Band",
    icon: "💍",
    slot: "accessory",
    description: "+3 Max HP",
    bonuses: { hpBonus: 3 },
  },
};

// ── Slot metadata (for UI labels / icons) ─────────────────────────────────────

export const EQUIPMENT_SLOTS = {
  weapon: { label: "Weapon", icon: "⚔️" },
  armor: { label: "Armor", icon: "🛡️" },
  accessory: { label: "Accessory", icon: "💍" },
  offhand: { label: "Off-hand", icon: "🛡️" },
};
