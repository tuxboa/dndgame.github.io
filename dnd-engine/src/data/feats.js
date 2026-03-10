/**
 * feats.js — Feat definitions for the level-up system.
 *
 * Each feat has:
 *   id          — unique string key
 *   name        — display name
 *   icon        — emoji
 *   description — one-liner shown in the feat picker
 *   prereq      — optional (player) => boolean gating function
 *   prereqLabel — human-readable requirement string (shown when locked)
 *   apply       — (playerSnapshot) => patchedPlayerSnapshot
 *                 Always appends the feat id to player.feats[].
 */

/** @type {Record<string, FeatDefinition>} */
export const FEATS = {
  alert: {
    id: "alert",
    name: "Alert",
    icon: "👁️",
    description:
      "+5 Initiative. You are always on guard and never caught off-guard.",
    apply: (p) => ({ ...p, feats: [...(p.feats ?? []), "alert"] }),
  },

  tough: {
    id: "tough",
    name: "Tough",
    icon: "🩺",
    description:
      "+2 Max HP per level (applied retroactively for all current levels).",
    apply: (p) => {
      const bonus = (p.level ?? 1) * 2;
      const newBaseMaxHp = (p.baseMaxHp ?? p.maxHp) + bonus;
      const equipGap = p.baseMaxHp != null ? p.maxHp - p.baseMaxHp : 0;
      const newMaxHp = newBaseMaxHp + equipGap;
      return {
        ...p,
        maxHp: newMaxHp,
        baseMaxHp: newBaseMaxHp,
        hp: Math.min(p.hp + bonus, newMaxHp),
        feats: [...(p.feats ?? []), "tough"],
      };
    },
  },

  war_caster: {
    id: "war_caster",
    name: "War Caster",
    icon: "🔮",
    description:
      "Advantage on Concentration saves. Cast spells as Opportunity Attacks.",
    prereq: (p) => (p.knownSpells?.length ?? 0) > 0,
    prereqLabel: "Requires: able to cast at least one spell",
    apply: (p) => ({ ...p, feats: [...(p.feats ?? []), "war_caster"] }),
  },

  lucky: {
    id: "lucky",
    name: "Lucky",
    icon: "🍀",
    description:
      "3 Luck Points per long rest. Spend one to reroll any attack, save, or check.",
    apply: (p) => ({
      ...p,
      luckPoints: 3,
      feats: [...(p.feats ?? []), "lucky"],
    }),
  },

  resilient_con: {
    id: "resilient_con",
    name: "Resilient (CON)",
    icon: "🛡",
    description:
      "+1 Constitution and proficiency in Constitution saving throws.",
    apply: (p) => ({
      ...p,
      abilities: { ...p.abilities, con: (p.abilities?.con ?? 10) + 1 },
      feats: [...(p.feats ?? []), "resilient_con"],
    }),
  },

  mobile: {
    id: "mobile",
    name: "Mobile",
    icon: "🏃",
    description:
      "+10 ft movement speed (30→40 ft). Disengage for free after Dash.",
    apply: (p) => ({
      ...p,
      movementSpeed: (p.movementSpeed ?? 30) + 10,
      feats: [...(p.feats ?? []), "mobile"],
    }),
  },

  sharpshooter: {
    id: "sharpshooter",
    name: "Sharpshooter",
    icon: "🎯",
    description:
      "Ranged attacks ignore cover penalties. No disadvantage from long range.",
    prereq: (p) => ["Ranger", "Fighter", "Rogue"].includes(p.class),
    prereqLabel: "Requires: Ranger, Fighter, or Rogue",
    apply: (p) => ({ ...p, feats: [...(p.feats ?? []), "sharpshooter"] }),
  },

  great_weapon_master: {
    id: "great_weapon_master",
    name: "Great Weapon Master",
    icon: "🪓",
    description:
      "On crit or kill with a heavy weapon, make a bonus melee attack.",
    prereq: (p) => ["Fighter", "Barbarian", "Paladin"].includes(p.class),
    prereqLabel: "Requires: Fighter, Barbarian, or Paladin",
    apply: (p) => ({
      ...p,
      feats: [...(p.feats ?? []), "great_weapon_master"],
    }),
  },

  actor: {
    id: "actor",
    name: "Actor",
    icon: "🎭",
    description: "+1 Charisma. Advantage on Deception and Performance checks.",
    apply: (p) => ({
      ...p,
      abilities: { ...p.abilities, cha: (p.abilities?.cha ?? 10) + 1 },
      feats: [...(p.feats ?? []), "actor"],
    }),
  },
};
