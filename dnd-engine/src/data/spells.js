/**
 * spells.js — Static spell + mana definitions.
 *
 * Schema (SpellDefinition):
 *   id             — unique string key
 *   name           — display name
 *   icon           — emoji shown in buttons & log
 *   manaCost       — MP consumed on cast
 *   type           — "damage" | "heal" | "buff"
 *   effect         — type-specific config (see below)
 *   description    — one-liner shown in spell picker
 *   requiresTarget — must select an enemy card before casting
 *
 * effect shapes:
 *   damage → { notation: "2d6", stat: "int" }
 *            • rolls notation, adds ability modifier of `stat`
 *   heal   → { notation: "1d8", stat: "wis" }
 *            • rolls notation, adds ability modifier of `stat`, heals self
 *   buff   → { acBonus: 2 }
 *            • grants flat AC bonus for the duration of combat
 */

/** @type {Record<string, SpellDefinition>} */
export const SPELLS = {
  fireball: {
    id: "fireball",
    name: "Fireball",
    icon: "🔥",
    manaCost: 10,
    type: "damage",
    aoe: true,
    savingThrow: { stat: "dex", halfOnSuccess: true },
    effect: { notation: "2d6", stat: "int" },
    description:
      "A ball of fire erupts, hitting ALL enemies. 2d6+INT fire (DEX save / half).",
    requiresTarget: false,
  },

  ice_lance: {
    id: "ice_lance",
    name: "Ice Lance",
    icon: "🧊",
    manaCost: 6,
    type: "damage",
    effect: { notation: "1d8", stat: "int" },
    description:
      "A shard of ice pierces the target. 1d8 + INT mod cold damage.",
    requiresTarget: true,
  },

  heal: {
    id: "heal",
    name: "Cure Wounds",
    icon: "💚",
    manaCost: 8,
    type: "heal",
    effect: { notation: "1d8", stat: "wis" },
    description:
      "Channel divine energy into yourself. Restore 1d8 + WIS modifier HP.",
    requiresTarget: false,
  },

  lesser_heal: {
    id: "lesser_heal",
    name: "Lay on Hands",
    icon: "🤲",
    manaCost: 4,
    type: "heal",
    effect: { notation: "1d4", stat: null },
    description: "A touch of healing warmth. Restore 1d4 HP.",
    requiresTarget: false,
  },

  shield_of_faith: {
    id: "shield_of_faith",
    name: "Shield of Faith",
    icon: "🛡️",
    manaCost: 6,
    type: "buff",
    concentration: true,
    effect: { acBonus: 2 },
    description:
      "A shimmering magical field surrounds you, granting +2 AC until combat ends.",
    requiresTarget: false,
  },

  bless: {
    id: "bless",
    name: "Bless",
    icon: "✨",
    manaCost: 5,
    type: "buff",
    concentration: true,
    effect: { acBonus: 0, attackBlessingDie: 4 },
    description: "+1d4 to attack rolls for the rest of combat (Concentration).",
    requiresTarget: false,
  },

  // ── Level 3+ unlocks ──────────────────────────────────────────────────────

  moonbeam: {
    id: "moonbeam",
    name: "Moonbeam",
    icon: "🌙",
    manaCost: 10,
    type: "damage",
    concentration: true,
    effect: { notation: "2d10", stat: "wis" },
    description:
      "A pale beam of radiance blasts a target. 2d10 + WIS mod radiant (Conc).",
    requiresTarget: true,
  },

  // ── Level 5+ unlocks ──────────────────────────────────────────────────────

  chain_lightning: {
    id: "chain_lightning",
    name: "Chain Lightning",
    icon: "⚡",
    manaCost: 18,
    type: "damage",
    aoe: true,
    savingThrow: { stat: "dex", halfOnSuccess: true },
    effect: { notation: "3d8", stat: "int" },
    description:
      "Lightning arcs through all enemies. 3d8+INT lightning (DEX save / half).",
    requiresTarget: false,
  },

  mass_cure_wounds: {
    id: "mass_cure_wounds",
    name: "Mass Cure Wounds",
    icon: "💖",
    manaCost: 18,
    type: "heal",
    aoe: true,
    effect: { notation: "3d8", stat: "wis" },
    description:
      "A wave of divine healing. Restore 3d8+WIS HP. (AOE — heals caster)",
    requiresTarget: false,
  },

  call_lightning: {
    id: "call_lightning",
    name: "Call Lightning",
    icon: "🌩️",
    manaCost: 14,
    type: "damage",
    aoe: true,
    savingThrow: { stat: "dex", halfOnSuccess: true },
    effect: { notation: "2d10", stat: "wis" },
    description:
      "Stormclouds unleash lightning on all enemies. 2d10+WIS (DEX save / half).",
    requiresTarget: false,
  },

  hypnotic_pattern: {
    id: "hypnotic_pattern",
    name: "Hypnotic Pattern",
    icon: "🌀",
    manaCost: 12,
    type: "damage",
    statusEffect: { id: "stun", duration: 2 },
    effect: { notation: "2d6", stat: "cha" },
    description:
      "Incapacitating colours daze a foe. 2d6+CHA psychic + Stun (2 turns).",
    requiresTarget: true,
  },

  hunger_of_hadar: {
    id: "hunger_of_hadar",
    name: "Hunger of Hadar",
    icon: "🕳️",
    manaCost: 14,
    type: "damage",
    statusEffect: { id: "blinded", duration: 2 },
    effect: { notation: "2d6", stat: "cha" },
    description:
      "A void of darkness blinds and chills a foe. 2d6+CHA cold + Blinded (2 turns).",
    requiresTarget: true,
  },

  // ── Level 7+ unlocks ──────────────────────────────────────────────────────

  meteor_swarm: {
    id: "meteor_swarm",
    name: "Meteor Swarm",
    icon: "☄️",
    manaCost: 28,
    type: "damage",
    aoe: true,
    savingThrow: { stat: "dex", halfOnSuccess: true },
    effect: { notation: "4d6", stat: "int" },
    description:
      "Blazing meteors rain on all enemies. 4d6+INT fire (DEX save / half).",
    requiresTarget: false,
  },

  spirit_guardians: {
    id: "spirit_guardians",
    name: "Spirit Guardians",
    icon: "👼",
    manaCost: 16,
    type: "damage",
    concentration: true,
    effect: { notation: "3d8", stat: "wis" },
    description:
      "Spectral spirits swarm the battlefield. 3d8 + WIS mod radiant (Conc).",
    requiresTarget: true,
  },
};

// ── Class mana pools at level 1 ───────────────────────────────────────────────
// Non-casters get a small pool so they can still use a minor ability.

/** @type {Record<string, number>} */
export const CLASS_MANA = {
  Wizard: 40,
  Sorcerer: 36,
  Druid: 30,
  Cleric: 28,
  Bard: 24,
  Warlock: 20,
  Ranger: 16,
  Paladin: 16,
  Monk: 14,
  Fighter: 8,
  Rogue: 6,
  Barbarian: 4,
};

// ── Known spells per class ────────────────────────────────────────────────────

/** @type {Record<string, string[]>} */
export const CLASS_SPELLS = {
  Wizard: ["fireball", "ice_lance", "heal", "shield_of_faith"],
  Sorcerer: ["fireball", "ice_lance", "heal"],
  Druid: ["heal", "lesser_heal", "shield_of_faith"],
  Cleric: ["heal", "lesser_heal", "shield_of_faith", "bless"],
  Bard: ["heal", "ice_lance"],
  Warlock: ["fireball", "ice_lance"],
  Ranger: ["lesser_heal"],
  Paladin: ["lesser_heal", "shield_of_faith", "bless"],
  Monk: ["lesser_heal"],
  Fighter: [],
  Rogue: [],
  Barbarian: [],
};

// ── Spells unlocked at specific levels per class ──────────────────────────────
// Format: { [level]: ["spell_id", ...] }
// Applied automatically by levelUpSystem.applyLevelUp.

/** @type {Record<string, Record<number, string[]>>} */
export const CLASS_LEVEL_SPELLS = {
  Wizard: { 5: ["chain_lightning"], 7: ["meteor_swarm"] },
  Sorcerer: { 5: ["chain_lightning"] },
  Cleric: { 5: ["mass_cure_wounds"], 7: ["spirit_guardians"] },
  Druid: { 3: ["moonbeam"], 5: ["call_lightning"] },
  Bard: { 5: ["hypnotic_pattern"] },
  Warlock: { 5: ["hunger_of_hadar"] },
};
