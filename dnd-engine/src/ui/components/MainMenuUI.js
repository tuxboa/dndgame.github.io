/**
 * MainMenuUI.js
 *
 * Pre-game entry flow mounted before the rest of the engine initialises.
 * Shows three screens in sequence:
 *
 *   1. Campaign Select  — pick a campaign (or resume a saved game)
 *   2. Character Form   — name + class
 *   3. Confirm & Start  — stat preview, then launches the game
 *
 * Usage:
 *   const result = await mountMainMenu(containerEl);
 *   // result is one of:
 *   //   { resumeSave: true }
 *   //   { campaignPath: string, playerData: PlayerData }
 */

import { hasSavedGame } from "../../systems/saveSystem.js";

// ── Campaign registry ─────────────────────────────────────────────────────────
// Add more entries here as you create additional campaign files.

const CAMPAIGNS = [
  {
    id: "great_upheaval",
    title: "A Great Upheaval",
    subtitle: "An Age of Chaos Begins",
    path: "/campaigns/campaign.json",
    icon: "🏰",
  },
  // Add more entries here once you have additional campaign.json files.
  // { id: "strahd", title: "Curse of Strahd", subtitle: "Gothic horror", path: "/campaigns/strahd.json", icon: "🧛" },
];

// ── Class definitions (all 12 PHB classes) ───────────────────────────────────

const CLASSES = [
  {
    id: "Barbarian",
    icon: "🪓",
    desc: "Rage-fueled warrior. Highest HP, unarmored might, relentless in melee.",
  },
  {
    id: "Bard",
    icon: "🎭",
    desc: "Performer and jack-of-all-trades. Inspires allies, magic through artistry.",
  },
  {
    id: "Cleric",
    icon: "⛪",
    desc: "Divine spellcaster. Heals, smites, and channels the power of the gods.",
  },
  {
    id: "Druid",
    icon: "🌿",
    desc: "Nature's servant. Shapeshifts, wields elemental magic, commands the wild.",
  },
  {
    id: "Fighter",
    icon: "⚔️",
    desc: "Master of weapons and armor. High HP, Second Wind, unmatched martial skill.",
  },
  {
    id: "Monk",
    icon: "🥋",
    desc: "Disciplined martial artist. Uses Ki to move swiftly and strike unarmed.",
  },
  {
    id: "Paladin",
    icon: "🛡️",
    desc: "Holy warrior. Heavy armor, healing hands, smites evil with radiant power.",
  },
  {
    id: "Ranger",
    icon: "🏹",
    desc: "Hunter of wild places. Tracks enemies, fights with bow or blade.",
  },
  {
    id: "Rogue",
    icon: "🗡️",
    desc: "Cunning and precise. Sneak Attack, Expertise, stealth and trickery.",
  },
  {
    id: "Sorcerer",
    icon: "✨",
    desc: "Magic in the blood. Raw Charisma power, Font of Magic, metamagic.",
  },
  {
    id: "Warlock",
    icon: "👁️",
    desc: "Eldritch patron. Short-rest spell slots, Eldritch Blast, dark invocations.",
  },
  {
    id: "Wizard",
    icon: "🔮",
    desc: "Scholar of the arcane. Massive spell list, Arcane Recovery, ritual casting.",
  },
];

// ── Race definitions (all 9 PHB races) ───────────────────────────────────────

const RACES = [
  {
    id: "Human",
    icon: "🧑",
    desc: "+1 to all abilities. Extra language and skill proficiency.",
    bonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    speed: 30,
  },
  {
    id: "Elf",
    icon: "🧝",
    desc: "+2 DEX. Darkvision 60 ft, Keen Senses, Trance, Fey Ancestry.",
    bonuses: { dex: 2 },
    speed: 30,
  },
  {
    id: "Dwarf",
    icon: "⛏️",
    desc: "+2 CON. Darkvision, Dwarven Resilience (poison), Stonecunning.",
    bonuses: { con: 2 },
    speed: 25,
  },
  {
    id: "Halfling",
    icon: "🍀",
    desc: "+2 DEX. Lucky (reroll 1s on attack/check/save), Brave, Nimbleness.",
    bonuses: { dex: 2 },
    speed: 25,
  },
  {
    id: "Dragonborn",
    icon: "🐉",
    desc: "+2 STR, +1 CHA. Breath weapon, elemental damage resistance.",
    bonuses: { str: 2, cha: 1 },
    speed: 30,
  },
  {
    id: "Gnome",
    icon: "🔬",
    desc: "+2 INT. Darkvision, Gnome Cunning (advantage on INT/WIS/CHA saves vs magic).",
    bonuses: { int: 2 },
    speed: 25,
  },
  {
    id: "Half-Elf",
    icon: "🌟",
    desc: "+2 CHA, +1 to two others. Darkvision, Fey Ancestry, Skill Versatility.",
    bonuses: { cha: 2, dex: 1, int: 1 },
    speed: 30,
  },
  {
    id: "Half-Orc",
    icon: "💪",
    desc: "+2 STR, +1 CON. Darkvision, Relentless Endurance, Savage Attacks.",
    bonuses: { str: 2, con: 1 },
    speed: 30,
  },
  {
    id: "Tiefling",
    icon: "😈",
    desc: "+2 CHA, +1 INT. Darkvision, Hellish Resistance (fire), Infernal Legacy.",
    bonuses: { cha: 2, int: 1 },
    speed: 30,
  },
];

// ── Stat tables ───────────────────────────────────────────────────────────────

/** Hit die per class (PHB). */
const HIT_DICE = {
  Barbarian: 12,
  Bard: 8,
  Cleric: 8,
  Druid: 8,
  Fighter: 10,
  Monk: 8,
  Paladin: 10,
  Ranger: 10,
  Rogue: 8,
  Sorcerer: 6,
  Warlock: 8,
  Wizard: 6,
};

/** Standard-array ability scores per class (PHB standard array 15,14,13,12,10,8). */
const BASE_ABILITIES = {
  Barbarian: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  Bard: { str: 8, dex: 14, con: 12, int: 13, wis: 10, cha: 15 },
  Cleric: { str: 13, dex: 10, con: 12, int: 8, wis: 15, cha: 14 },
  Druid: { str: 8, dex: 13, con: 12, int: 14, wis: 15, cha: 10 },
  Fighter: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
  Monk: { str: 13, dex: 15, con: 12, int: 10, wis: 14, cha: 8 },
  Paladin: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  Ranger: { str: 13, dex: 15, con: 12, int: 8, wis: 14, cha: 10 },
  Rogue: { str: 12, dex: 15, con: 13, int: 14, wis: 10, cha: 8 },
  Sorcerer: { str: 8, dex: 13, con: 14, int: 12, wis: 10, cha: 15 },
  Warlock: { str: 10, dex: 13, con: 12, int: 14, wis: 8, cha: 15 },
  Wizard: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
};

/** Base AC per class (typical starting armour). */
const BASE_AC = {
  Barbarian: 13,
  Bard: 11,
  Cleric: 16,
  Druid: 13,
  Fighter: 16,
  Monk: 14,
  Paladin: 16,
  Ranger: 15,
  Rogue: 13,
  Sorcerer: 11,
  Warlock: 11,
  Wizard: 12,
};

const STARTER_GOLD = {
  Barbarian: 20,
  Bard: 40,
  Cleric: 30,
  Druid: 15,
  Fighter: 25,
  Monk: 10,
  Paladin: 30,
  Ranger: 20,
  Rogue: 30,
  Sorcerer: 25,
  Warlock: 20,
  Wizard: 35,
};

/** Starter inventory per class. */
const STARTER_ITEMS = {
  Barbarian: [
    {
      itemId: "greataxe",
      name: "Greataxe",
      quantity: 1,
      description: "1d12 slashing, two-handed",
      value: 30,
    },
    {
      itemId: "handaxe",
      name: "Handaxe",
      quantity: 2,
      description: "1d6 slashing, thrown 20/60 ft",
      value: 5,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 2,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Bard: [
    {
      itemId: "rapier",
      name: "Rapier",
      quantity: 1,
      description: "+1 attack · 1d8 piercing, finesse",
      value: 25,
      finesse: true,
    },
    {
      itemId: "leather_armor",
      name: "Leather Armor",
      quantity: 1,
      description: "+1 AC",
      value: 10,
    },
    {
      itemId: "lute",
      name: "Lute",
      quantity: 1,
      description: "Musical instrument — Bardic Inspiration",
      value: 35,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 1,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Cleric: [
    {
      itemId: "mace",
      name: "Mace",
      quantity: 1,
      description: "1d6 bludgeoning",
      value: 5,
    },
    {
      itemId: "chain_mail",
      name: "Chain Mail",
      quantity: 1,
      description: "+4 AC, heavy armor",
      value: 40,
    },
    {
      itemId: "shield",
      name: "Shield",
      quantity: 1,
      description: "+2 AC",
      value: 10,
    },
    {
      itemId: "holy_symbol",
      name: "Holy Symbol",
      quantity: 1,
      description: "Divine focus for spellcasting",
      value: 5,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 2,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Druid: [
    {
      itemId: "scimitar",
      name: "Scimitar",
      quantity: 1,
      description: "1d6 slashing, finesse",
      value: 25,
      finesse: true,
    },
    {
      itemId: "leather_armor",
      name: "Leather Armor",
      quantity: 1,
      description: "+1 AC (no metal)",
      value: 10,
    },
    {
      itemId: "wooden_shield",
      name: "Wooden Shield",
      quantity: 1,
      description: "+2 AC (no metal)",
      value: 10,
    },
    {
      itemId: "druidic_focus",
      name: "Druidic Focus",
      quantity: 1,
      description: "Spellcasting focus for druids",
      value: 5,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 1,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Fighter: [
    {
      itemId: "iron_sword",
      name: "Iron Sword",
      quantity: 1,
      description: "+2 attack · 1d8 slashing",
      value: 15,
    },
    {
      itemId: "chain_mail",
      name: "Chain Mail",
      quantity: 1,
      description: "+4 AC",
      value: 40,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 2,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Monk: [
    {
      itemId: "shortsword",
      name: "Shortsword",
      quantity: 1,
      description: "1d6 piercing, finesse",
      value: 10,
      finesse: true,
    },
    {
      itemId: "dart",
      name: "Dart",
      quantity: 10,
      description: "1d4 piercing, thrown 20/60 ft",
      value: 0.05,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 1,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Paladin: [
    {
      itemId: "longsword",
      name: "Longsword",
      quantity: 1,
      description: "+2 attack · 1d8 slashing",
      value: 15,
    },
    {
      itemId: "chain_mail",
      name: "Chain Mail",
      quantity: 1,
      description: "+4 AC, heavy armor",
      value: 40,
    },
    {
      itemId: "shield",
      name: "Shield",
      quantity: 1,
      description: "+2 AC",
      value: 10,
    },
    {
      itemId: "holy_symbol",
      name: "Holy Symbol",
      quantity: 1,
      description: "Divine focus — channel divine smite",
      value: 5,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 2,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Ranger: [
    {
      itemId: "shortsword",
      name: "Shortsword",
      quantity: 2,
      description: "1d6 piercing, finesse",
      value: 10,
      finesse: true,
    },
    {
      itemId: "scale_mail",
      name: "Scale Mail",
      quantity: 1,
      description: "+2 AC (medium, DEX max +2)",
      value: 50,
    },
    {
      itemId: "longbow",
      name: "Longbow",
      quantity: 1,
      description: "1d8 piercing, range 150/600 ft",
      value: 50,
    },
    {
      itemId: "arrow",
      name: "Arrow",
      quantity: 20,
      description: "Ammunition for longbow",
      value: 0.05,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 1,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Rogue: [
    {
      itemId: "shortsword",
      name: "Shortsword",
      quantity: 1,
      description: "+1 attack · 1d6 finesse",
      value: 10,
      finesse: true,
    },
    {
      itemId: "leather_armor",
      name: "Leather Armor",
      quantity: 1,
      description: "+2 AC",
      value: 10,
    },
    {
      itemId: "thieves_tools",
      name: "Thieves' Tools",
      quantity: 1,
      description: "For picking locks & disarming traps.",
      value: 25,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 1,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Sorcerer: [
    {
      itemId: "dagger",
      name: "Dagger",
      quantity: 2,
      description: "1d4 piercing, finesse, thrown 20/60 ft",
      value: 2,
      finesse: true,
    },
    {
      itemId: "component_pouch",
      name: "Component Pouch",
      quantity: 1,
      description: "Material components for spellcasting",
      value: 25,
    },
    {
      itemId: "arcane_focus",
      name: "Arcane Focus",
      quantity: 1,
      description: "Crystal focus for sorcery spells",
      value: 10,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 1,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Warlock: [
    {
      itemId: "dagger",
      name: "Dagger",
      quantity: 2,
      description: "1d4 piercing, finesse, thrown 20/60 ft",
      value: 2,
      finesse: true,
    },
    {
      itemId: "leather_armor",
      name: "Leather Armor",
      quantity: 1,
      description: "+1 AC",
      value: 10,
    },
    {
      itemId: "arcane_focus",
      name: "Arcane Focus",
      quantity: 1,
      description: "Tome or Rod — patron-granted focus",
      value: 10,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 1,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
  Wizard: [
    {
      itemId: "quarterstaff",
      name: "Quarterstaff",
      quantity: 1,
      description: "1d6 bludgeoning, versatile (1d8)",
      value: 5,
    },
    {
      itemId: "spell_tome",
      name: "Spellbook",
      quantity: 1,
      description: "Contains your starting spells",
      value: 50,
    },
    {
      itemId: "arcane_focus",
      name: "Arcane Focus",
      quantity: 1,
      description: "Orb or wand for spellcasting",
      value: 10,
    },
    {
      itemId: "health_potion_minor",
      name: "Minor Healing Potion",
      quantity: 1,
      description: "Restores 2d4+2 HP.",
      value: 25,
      healDice: "2d4+2",
    },
  ],
};

// ── Module-level state (reset on each mountMainMenu call) ─────────────────────

let _step = 1;
let _campaign = null; // { id, path }
let _character = {
  name: "",
  class: CLASSES[0].id,
  race: RACES[0].id,
  baseAbs: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
};
let _container = null;
let _resolve = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mount the main menu into `containerEl`.
 * Resolves when the player either starts a new adventure or resumes a save.
 *
 * @param {HTMLElement} containerEl
 * @returns {Promise<{ resumeSave: true } | { campaignPath: string, playerData: object }>}
 */
export function mountMainMenu(containerEl) {
  _container = containerEl;
  _step = 1;
  _campaign = null;
  _character = {
    name: "",
    class: CLASSES[0].id,
    race: RACES[0].id,
    baseAbs: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
  };

  return new Promise((resolve) => {
    _resolve = resolve;
    _render();
  });
}

// ── Screen rendering ──────────────────────────────────────────────────────────

function _render() {
  _container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "mm-wrap";
  _container.appendChild(wrap);

  switch (_step) {
    case 1:
      _renderCampaignSelect(wrap);
      break;
    case 2:
      _renderCharForm(wrap);
      break;
    case 3:
      _renderConfirm(wrap);
      break;
  }

  // Trigger enter animation on the next frame so the transition fires
  requestAnimationFrame(() => {
    requestAnimationFrame(() => wrap.classList.add("mm-wrap--visible"));
  });
}

/**
 * Animate the current screen out, then render the next one.
 * @param {number} nextStep
 */
function _transition(nextStep) {
  const wrap = _container.querySelector(".mm-wrap");
  if (!wrap) {
    _step = nextStep;
    _render();
    return;
  }

  wrap.classList.add("mm-wrap--exit");
  wrap.addEventListener(
    "animationend",
    () => {
      _step = nextStep;
      _render();
    },
    { once: true },
  );
}

// ── Screen 1: Campaign Select ─────────────────────────────────────────────────

function _renderCampaignSelect(wrap) {
  const hasSave = hasSavedGame();

  wrap.innerHTML = `
    <div class="mm-bg-overlay"></div>

    <div class="mm-content">
      <header class="mm-header">
        <h1 class="mm-title">Dark Realm</h1>
        <p class="mm-tagline">Steel your resolve. Choose your fate.</p>
      </header>

      ${
        hasSave
          ? `
        <section class="mm-section">
          <button id="mm-continue" class="mm-continue-btn">
            <span class="mm-continue-icon">📖</span>
            <div class="mm-continue-text">
              <span class="mm-continue-label">Continue Saved Adventure</span>
              <span class="mm-continue-sub">Resume where you left off</span>
            </div>
            <span class="mm-continue-arrow">→</span>
          </button>
        </section>
        <div class="mm-divider"><span>or start a new adventure</span></div>
      `
          : ""
      }

      <section class="mm-section">
        <h2 class="mm-section-title">Choose Your Campaign</h2>
        <div class="mm-campaign-grid">
          ${CAMPAIGNS.map(
            (c) => `
            <button class="mm-campaign-card" data-id="${c.id}" data-path="${c.path}">
              <span class="mm-campaign-icon">${c.icon}</span>
              <div class="mm-campaign-text">
                <span class="mm-campaign-title">${c.title}</span>
                <span class="mm-campaign-sub">${c.subtitle}</span>
              </div>
              <span class="mm-campaign-arrow">→</span>
            </button>
          `,
          ).join("")}
        </div>
      </section>
    </div>
  `;

  wrap.querySelector("#mm-continue")?.addEventListener("click", () => {
    _resolve({ resumeSave: true });
  });

  wrap.querySelectorAll(".mm-campaign-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      _campaign = { id: btn.dataset.id, path: btn.dataset.path };
      _transition(2);
    });
  });
}

// ── Screen 2: Character Spreadsheet ─────────────────────────────────────────

const _ABILITY_FULL = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// ── Extended D&D 5e reference data ────────────────────────────────────────────

/** Saving throw proficiencies per class (PHB) */
const SAVING_THROWS = {
  Barbarian: ["str", "con"],
  Bard: ["dex", "cha"],
  Cleric: ["wis", "cha"],
  Druid: ["int", "wis"],
  Fighter: ["str", "con"],
  Monk: ["str", "dex"],
  Paladin: ["wis", "cha"],
  Ranger: ["str", "dex"],
  Rogue: ["dex", "int"],
  Sorcerer: ["con", "cha"],
  Warlock: ["wis", "cha"],
  Wizard: ["int", "wis"],
};

/** Skill proficiencies granted at level 1 per class */
const CLASS_SKILLS = {
  Barbarian: ["Athletics", "Intimidation"],
  Bard: ["Persuasion", "Performance", "Deception"],
  Cleric: ["Medicine", "Religion"],
  Druid: ["Animal Handling", "Nature", "Perception"],
  Fighter: ["Athletics", "Intimidation"],
  Monk: ["Acrobatics", "Insight"],
  Paladin: ["Athletics", "Persuasion"],
  Ranger: ["Animal Handling", "Stealth", "Survival"],
  Rogue: ["Stealth", "Sleight of Hand", "Deception", "Perception"],
  Sorcerer: ["Arcana", "Persuasion"],
  Warlock: ["Arcana", "Deception"],
  Wizard: ["Arcana", "Investigation"],
};

/** All 18 D&D 5e skills with governing ability (PHB p.174) */
const ALL_SKILLS = [
  {
    name: "Acrobatics",
    ability: "dex",
    desc: "Perform acrobatic stunts: tumble, flip, balance on a tightrope.",
  },
  {
    name: "Animal Handling",
    ability: "wis",
    desc: "Calm animals, sense their intentions, control mounts in danger.",
  },
  {
    name: "Arcana",
    ability: "int",
    desc: "Recall lore about spells, magic items, planes, and magical traditions.",
  },
  {
    name: "Athletics",
    ability: "str",
    desc: "Climb, jump, swim, grapple — challenges of brute physical effort.",
  },
  {
    name: "Deception",
    ability: "cha",
    desc: "Mislead others through lies, misdirection, or disguise.",
  },
  {
    name: "History",
    ability: "int",
    desc: "Recall historical events, legendary people, ancient kingdoms, wars.",
  },
  {
    name: "Insight",
    ability: "wis",
    desc: "Gauge true intentions — detect lies, read emotions, predict behavior.",
  },
  {
    name: "Intimidation",
    ability: "cha",
    desc: "Influence others through threats, hostile action, or fearsome presence.",
  },
  {
    name: "Investigation",
    ability: "int",
    desc: "Search for clues, deduce how things work, and find hidden objects.",
  },
  {
    name: "Medicine",
    ability: "wis",
    desc: "Stabilize the dying, diagnose illness, and tend grievous wounds.",
  },
  {
    name: "Nature",
    ability: "int",
    desc: "Recall lore about terrain, plants, animals, weather, and natural cycles.",
  },
  {
    name: "Perception",
    ability: "wis",
    desc: "Spot, hear, or detect the presence of something via your senses.",
  },
  {
    name: "Performance",
    ability: "cha",
    desc: "Delight an audience with music, dance, acting, or storytelling.",
  },
  {
    name: "Persuasion",
    ability: "cha",
    desc: "Influence others through tact, social grace, good will — and flattery.",
  },
  {
    name: "Religion",
    ability: "int",
    desc: "Recall lore about deities, rites, prayers, and holy symbols.",
  },
  {
    name: "Sleight of Hand",
    ability: "dex",
    desc: "Pick pockets, conceal small objects, perform manual trickery.",
  },
  {
    name: "Stealth",
    ability: "dex",
    desc: "Conceal yourself from enemies, move silently, hide in shadows.",
  },
  {
    name: "Survival",
    ability: "wis",
    desc: "Follow tracks, hunt, navigate wilderness, predict weather, forage.",
  },
];

/** Level-1 class features (PHB) */
const CLASS_FEATURES = {
  Barbarian: [
    {
      name: "Rage",
      desc: "Bonus action: enter rage for 1 min. +2 dmg on STR attacks, resistance to B/P/S damage, advantage on STR checks. 2/day.",
    },
    {
      name: "Unarmored Defense",
      desc: "While not wearing armor, AC = 10 + DEX mod + CON mod. Still benefit from a shield.",
    },
  ],
  Bard: [
    {
      name: "Spellcasting",
      desc: "CHA-based. Cantrips: 2. 1st-level slots: 2. Spell save DC = 8 + prof + CHA mod. Knows 4 spells.",
    },
    {
      name: "Bardic Inspiration",
      desc: "Bonus action: grant a creature within 60 ft a d6 to add to one ability check, attack roll, or saving throw. CHA mod times per long rest.",
    },
  ],
  Cleric: [
    {
      name: "Spellcasting",
      desc: "WIS-based. Cantrips: 3. 1st-level slots: 2. Spell save DC = 8 + prof + WIS mod. Prepares WIS mod + level spells.",
    },
    {
      name: "Divine Domain",
      desc: "Choose a domain (e.g., Life, Light, War) granting bonus spells and domain features.",
    },
    {
      name: "Channel Divinity",
      desc: "Turn Undead: each undead within 30 ft must succeed on a WIS save or flee for 1 minute. 1/short rest.",
    },
  ],
  Druid: [
    {
      name: "Druidic",
      desc: "Speak and understand Druidic, the secret language of druids. Hidden messages in natural speech.",
    },
    {
      name: "Spellcasting",
      desc: "WIS-based. Cantrips: 2. 1st-level slots: 2. Spell save DC = 8 + prof + WIS mod. Ritual casting.",
    },
  ],
  Fighter: [
    {
      name: "Second Wind",
      desc: "Bonus action: regain 1d10 + 1 HP. Recharges on short or long rest.",
    },
    {
      name: "Fighting Style",
      desc: "Choose one: Archery, Defense, Dueling, Great Weapon Fighting, Protection, or Two-Weapon Fighting.",
    },
  ],
  Monk: [
    {
      name: "Martial Arts",
      desc: "Unarmed strikes and monk weapons deal 1d4 damage. Use DEX instead of STR. Bonus unarmed strike after attacking.",
    },
    {
      name: "Unarmored Defense",
      desc: "AC = 10 + DEX mod + WIS mod while wearing no armor and no shield.",
    },
  ],
  Paladin: [
    {
      name: "Divine Sense",
      desc: "As an action, detect celestials, fiends, and undead within 60 ft. Usable 1 + CHA mod times per long rest.",
    },
    {
      name: "Lay on Hands",
      desc: "Pool of 5 HP × level. As an action, restore HP or expend 5 HP to cure a disease or neutralize a poison.",
    },
  ],
  Ranger: [
    {
      name: "Favored Enemy",
      desc: "Choose a creature type. Advantage on Survival checks to track and INT checks to recall information about them.",
    },
    {
      name: "Natural Explorer",
      desc: "Choose a favored terrain. Difficult terrain doesn't slow travel, ignore common hazards, always alert while tracking.",
    },
  ],
  Rogue: [
    {
      name: "Sneak Attack",
      desc: "Once per turn, deal +1d6 damage when you have advantage or an ally flanks your target.",
    },
    {
      name: "Expertise",
      desc: "Double your proficiency bonus for two chosen skill proficiencies.",
    },
    {
      name: "Thieves' Cant",
      desc: "Secret language and signals known only to rogues. Hidden messages in normal speech.",
    },
  ],
  Sorcerer: [
    {
      name: "Spellcasting",
      desc: "CHA-based. Cantrips: 4. 1st-level slots: 2. Spell save DC = 8 + prof + CHA mod. Knows 2 spells.",
    },
    {
      name: "Sorcerous Origin",
      desc: "Choose Draconic Bloodline or Wild Magic — grants bonus features, spells, and a shaping source for your power.",
    },
  ],
  Warlock: [
    {
      name: "Othworldly Patron",
      desc: "Choose Archfey, Fiend, or Great Old One. Grants expanded spells and patron-specific features.",
    },
    {
      name: "Pact Magic",
      desc: "CHA-based. 1st-level spell slots: 1 (recover on short rest). Spell save DC = 8 + prof + CHA mod. Knows 2 spells.",
    },
    {
      name: "Eldritch Blast",
      desc: "Cantrip: 1d10 force damage, 120 ft range. Your signature invocation.",
    },
  ],
  Wizard: [
    {
      name: "Spellcasting",
      desc: "INT-based. Cantrips: 3. 1st-level slots: 2. Spell save DC = 8 + prof + INT mod. Ritual casting.",
    },
    {
      name: "Arcane Recovery",
      desc: "Once per day on a short rest, recover spell slots with combined level ≤ half your Wizard level (min 1).",
    },
  ],
};

/** Weapon proficiencies per class (PHB) */
const WEAPON_PROFS = {
  Barbarian: "All simple & martial weapons",
  Bard: "Simple weapons, hand crossbows, longswords, rapiers, shortswords",
  Cleric: "Simple weapons",
  Druid:
    "Clubs, daggers, darts, javelins, maces, quarterstaffs, scimitars, sickles, slings, spears",
  Fighter: "All simple & martial weapons",
  Monk: "Simple weapons & shortswords",
  Paladin: "All simple & martial weapons",
  Ranger: "All simple & martial weapons",
  Rogue: "Simple weapons, hand crossbows, longswords, rapiers, shortswords",
  Sorcerer: "Daggers, darts, slings, quarterstaffs, light crossbows",
  Warlock: "Simple weapons",
  Wizard: "Daggers, darts, slings, quarterstaffs, light crossbows",
};

/** Armor proficiencies per class (PHB) */
const ARMOR_PROFS = {
  Barbarian: "Light & medium armor, shields",
  Bard: "Light armor",
  Cleric: "Light, medium & heavy armor, shields",
  Druid: "Light & medium armor, shields (no metal)",
  Fighter: "All armor & shields",
  Monk: "None",
  Paladin: "All armor & shields",
  Ranger: "Light & medium armor, shields",
  Rogue: "Light armor",
  Sorcerer: "None",
  Warlock: "Light armor",
  Wizard: "None",
};

/** Starting languages (PHB p.123) */
const LANGUAGES = "Common + one additional";

/** Point-buy costs per score value (PHB p.13) */
const PB_COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const PB_BUDGET = 27;

// ─────────────────────────────────────────────────────────────────────────────

function _renderCharForm(wrap) {
  let currentClass = _character.class;
  let currentRace = _character.race;

  const _buildSheet = (cls, race) => {
    const raceDef = RACES.find((r) => r.id === race) ?? RACES[0];
    // Apply racial ASI on top of user-assigned base scores
    const abs = { ..._character.baseAbs };
    for (const [k, v] of Object.entries(raceDef.bonuses)) {
      abs[k] = (abs[k] ?? 0) + v;
    }
    const speed = raceDef.speed ?? 30;
    const hd = HIT_DICE[cls];
    const conMod = Math.floor((abs.con - 10) / 2);
    const dexMod = Math.floor((abs.dex - 10) / 2);
    const maxHp = hd + conMod;
    const ac = BASE_AC[cls];
    const gold = STARTER_GOLD[cls];
    const classDef = CLASSES.find((c) => c.id === cls);
    const saves = SAVING_THROWS[cls];
    const profSkills = CLASS_SKILLS[cls];
    const features = CLASS_FEATURES[cls];
    const profBonus = 2;
    const initMod = dexMod;
    const initStr = (initMod >= 0 ? "+" : "") + initMod;

    const pills = CLASSES.map(
      (c) =>
        `<button class="mm-sheet-pill mm-class-pill${c.id === cls ? " mm-sheet-pill--active" : ""}" data-class="${c.id}" type="button">${c.icon} ${c.id}</button>`,
    ).join("");

    const racePills = RACES.map(
      (r) =>
        `<button class="mm-sheet-pill mm-race-pill${r.id === race ? " mm-sheet-pill--active" : ""}" data-race="${r.id}" type="button">${r.icon} ${r.id}</button>`,
    ).join("");

    // Saving throw rows (all 6 abilities)
    const saveRows = ["str", "dex", "con", "int", "wis", "cha"]
      .map((ab) => {
        const prof = saves.includes(ab);
        const mod = Math.floor((abs[ab] - 10) / 2) + (prof ? profBonus : 0);
        const sign = mod >= 0 ? "+" : "";
        return `<li class="mm-cs-throw-row${prof ? " mm-cs-throw-row--prof" : ""}">
          <span class="mm-cs-dot">${prof ? "●" : "○"}</span>
          <span class="mm-cs-throw-val">${sign}${mod}</span>
          <span class="mm-cs-throw-name">${_ABILITY_FULL[ab]}</span>
        </li>`;
      })
      .join("");

    // Skill rows (all 18 skills)
    const skillRows = ALL_SKILLS.map((sk) => {
      const prof = profSkills.includes(sk.name);
      const abMod = Math.floor((abs[sk.ability] - 10) / 2);
      const total = abMod + (prof ? profBonus : 0);
      const sign = total >= 0 ? "+" : "";
      return `<li class="mm-cs-skill-row${prof ? " mm-cs-skill-row--prof" : ""}"
        data-skill="${sk.name}"
        data-desc="${sk.desc}"
        data-ab="${sk.ability.toUpperCase()}"
        data-val="${sign}${total}"
        data-prof="${prof}">
        <span class="mm-cs-dot">${prof ? "●" : "○"}</span>
        <span class="mm-cs-skill-val">${sign}${total}</span>
        <span class="mm-cs-skill-name">${sk.name}</span>
        <span class="mm-cs-skill-ab">${sk.ability.toUpperCase()}</span>
      </li>`;
    }).join("");

    // Feature cards
    const featureCards = features
      .map(
        (f) => `<div class="mm-cs-feature">
          <div class="mm-cs-feature-name">${f.name}</div>
          <div class="mm-cs-feature-desc">${f.desc}</div>
        </div>`,
      )
      .join("");

    // Gear list
    const gearItems = (STARTER_ITEMS[cls] ?? [])
      .map(
        (item) => `<div class="mm-cs-gear-item">
          <span class="mm-cs-gear-name">${item.name}</span>
          <span class="mm-cs-gear-qty">×${item.quantity}</span>
          <span class="mm-cs-gear-desc">${item.description}</span>
        </div>`,
      )
      .join("");

    // ── Interactive ability score boxes (point buy only) ──────────────────
    const baseAbs = _character.baseAbs;
    const AB_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
    const pointsSpent = AB_KEYS.reduce(
      (s, k) => s + (PB_COSTS[baseAbs[k]] ?? 0),
      0,
    );
    const pointsLeft = PB_BUDGET - pointsSpent;

    const abilityBoxes = AB_KEYS.map((key) => {
      const baseVal = baseAbs[key];
      const racial = raceDef.bonuses[key] ?? 0;
      const finalVal = baseVal + racial;

      const curCost = PB_COSTS[baseVal] ?? 0;
      const nextCost = PB_COSTS[baseVal + 1] ?? 99;
      const canUp = baseVal < 15 && nextCost - curCost <= pointsLeft;
      const canDown = baseVal > 8;
      const control = `<div class="mm-ability-stepper">
          <button class="mm-ability-btn" data-ab="${key}" data-dir="-1" type="button"${canDown ? "" : " disabled"}>−</button>
          <span class="mm-ability-base">${baseVal}</span>
          <button class="mm-ability-btn" data-ab="${key}" data-dir="1" type="button"${canUp ? "" : " disabled"}>+</button>
        </div>`;

      return `<div class="mm-ability-box mm-ability-box--edit">
        <span class="mm-ability-name">${key.toUpperCase()}</span>
        ${control}
        <span class="mm-ability-racial">${racial > 0 ? `+${racial} racial` : ""}</span>
        <span class="mm-ability-final">${finalVal}</span>
        <span class="mm-ability-mod">${_fmtMod(finalVal)}</span>
      </div>`;
    }).join("");

    const pointsBar = `<div class="mm-ab-points-bar">
      <span class="mm-ab-points-label">Point Buy</span>
      <span class="mm-ab-points${pointsLeft === 0 ? " mm-ab-points--done" : ""}">${pointsLeft} / ${PB_BUDGET} pts remaining</span>
    </div>`;

    return `
      <!-- ── Left page: Abilities · Saves ── -->
      <div class="mm-cs-page">

        <div class="mm-cs-section">
          <div class="mm-cs-section-label">⚔️ Choose Class</div>
          <div class="mm-sheet-pills mm-cs-pills">${pills}</div>
        </div>

        <div class="mm-cs-section">
          <div class="mm-cs-section-label">🌍 Choose Race</div>
          <div class="mm-sheet-pills mm-cs-pills">${racePills}</div>
        </div>

        <div class="mm-cs-section mm-cs-section--fill">
          <div class="mm-cs-section-label">🧠 Ability Scores</div>
          ${pointsBar}
          <div class="mm-ability-grid" id="mm-ability-grid">${abilityBoxes}</div>
        </div>

      </div>

      <!-- ── Right page: Combat · Skills · Features · Gear ── -->
      <div class="mm-cs-page">

        <div class="mm-cs-section">
          <div class="mm-cs-identity-banner">
            <div class="mm-cs-ib-class">
              <span class="mm-cs-ib-icon">${classDef.icon}</span>
              <span class="mm-cs-ib-name">${cls}</span>
              <span class="mm-cs-ib-sub">Class</span>
            </div>
            <div class="mm-cs-ib-sep">×</div>
            <div class="mm-cs-ib-race">
              <span class="mm-cs-ib-icon">${raceDef.icon}</span>
              <span class="mm-cs-ib-name">${raceDef.id}</span>
              <span class="mm-cs-ib-sub">Race</span>
            </div>
            <div class="mm-cs-ib-desc">${classDef.desc}</div>
          </div>
        </div>

        <div class="mm-cs-section">
          <div class="mm-cs-section-label">⚡ Combat Statistics</div>
          <div class="mm-cs-combat-row">
            <div class="mm-cs-combat-box mm-cs-combat-box--hp">
              <div class="mm-cs-combat-icon">❤️</div>
              <div class="mm-cs-combat-val">${maxHp}</div>
              <div class="mm-cs-combat-sub">d${hd}</div>
              <div class="mm-cs-combat-label">Hit Points</div>
            </div>
            <div class="mm-cs-combat-box mm-cs-combat-box--ac">
              <div class="mm-cs-combat-icon">🛡️</div>
              <div class="mm-cs-combat-val">${ac}</div>
              <div class="mm-cs-combat-label">Armor Class</div>
            </div>
            <div class="mm-cs-combat-box mm-cs-combat-box--init">
              <div class="mm-cs-combat-icon">⚡</div>
              <div class="mm-cs-combat-val">${initStr}</div>
              <div class="mm-cs-combat-label">Initiative</div>
            </div>
            <div class="mm-cs-combat-box mm-cs-combat-box--spd">
              <div class="mm-cs-combat-icon">🏃</div>
              <div class="mm-cs-combat-val">${speed}<span class="mm-cs-combat-unit">ft</span></div>
              <div class="mm-cs-combat-label">Speed</div>
            </div>
            <div class="mm-cs-combat-box mm-cs-combat-box--prof">
              <div class="mm-cs-combat-icon">⭐</div>
              <div class="mm-cs-combat-val">+2</div>
              <div class="mm-cs-combat-label">Prof. Bonus</div>
            </div>
            <div class="mm-cs-combat-box mm-cs-combat-box--gold">
              <div class="mm-cs-combat-icon">💰</div>
              <div class="mm-cs-combat-val">${gold}<span class="mm-cs-combat-unit">gp</span></div>
              <div class="mm-cs-combat-label">Gold</div>
            </div>
          </div>
        </div>

        <div class="mm-cs-section mm-cs-section--fill">
          <div class="mm-cs-section-label">✨ Class Features</div>
          <div class="mm-cs-features">${featureCards}</div>
        </div>

        <div class="mm-cs-section">
          <div class="mm-cs-section-label">🎒 Starting Equipment</div>
          <div class="mm-cs-gear">${gearItems}</div>
        </div>

      </div>
    `;
  };

  // ── Wire interactivity ────────────────────────────────────────────────────
  const _rewire = () => {
    const nameInput = wrap.querySelector("#mm-name");
    if (nameInput) {
      nameInput.addEventListener("input", () => {
        _character.name = nameInput.value.trim();
      });
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") wrap.querySelector("#mm-start")?.click();
      });
    }

    wrap.querySelectorAll(".mm-class-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.class === currentClass) return;
        _character.name =
          wrap.querySelector("#mm-name")?.value.trim() ?? _character.name;
        currentClass = btn.dataset.class;
        _character.class = currentClass;
        _character.baseAbs = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
        _rebuildSheet();
      });
    });

    // Point buy: stepper +/− buttons — patch in-place to avoid scroll jump
    // Skill tooltip — reuse single instance, remove old one first
    document.querySelectorAll(".mm-skill-tooltip").forEach((el) => el.remove());
    const tooltip = document.createElement("div");
    tooltip.className = "mm-skill-tooltip";
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);
    const _removeTooltip = () => {
      tooltip.style.display = "none";
    };
    wrap.querySelectorAll(".mm-cs-skill-row").forEach((row) => {
      row.addEventListener("mouseenter", (e) => {
        const name = row.dataset.skill;
        const desc = row.dataset.desc;
        const ab = row.dataset.ab;
        const val = row.dataset.val;
        const prof = row.dataset.prof === "true";
        tooltip.innerHTML = `
          <div class="mm-stt-header">
            <span class="mm-stt-name">${name}</span>
            <span class="mm-stt-badge mm-stt-badge--${ab.toLowerCase()}">${ab}</span>
            ${prof ? `<span class="mm-stt-prof">✦ Proficient</span>` : ""}
          </div>
          <div class="mm-stt-val">${val}</div>
          <div class="mm-stt-desc">${desc}</div>
        `;
        tooltip.style.display = "block";
        const rect = row.getBoundingClientRect();
        const ttW = 220;
        let left = rect.right + 8;
        if (left + ttW > window.innerWidth) left = rect.left - ttW - 8;
        tooltip.style.left = left + "px";
        tooltip.style.top =
          Math.min(rect.top, window.innerHeight - tooltip.offsetHeight - 8) +
          "px";
      });
      row.addEventListener("mouseleave", _removeTooltip);
    });
    // Clean up tooltip when navigating away
    wrap.addEventListener("mouseleave", _removeTooltip);

    // Feature accordion toggle
    wrap.querySelectorAll(".mm-cs-feature").forEach((card) => {
      card.addEventListener("click", () => {
        card.classList.toggle("mm-cs-feature--open");
      });
    });

    wrap.querySelectorAll(".mm-ability-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ab = btn.dataset.ab;
        const dir = parseInt(btn.dataset.dir, 10);
        _character.baseAbs[ab] = Math.max(
          8,
          Math.min(15, _character.baseAbs[ab] + dir),
        );
        _patchAbilities();
      });
    });

    wrap.querySelectorAll(".mm-race-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.race === currentRace) return;
        _character.name =
          wrap.querySelector("#mm-name")?.value.trim() ?? _character.name;
        currentRace = btn.dataset.race;
        _character.race = currentRace;
        _rebuildSheet();
      });
    });
  };

  // Rebuild whole charsheet (class/race change) preserving each page's scroll
  const _rebuildSheet = () => {
    const pages = [...wrap.querySelectorAll(".mm-cs-page")];
    const scrolls = pages.map((p) => p.scrollTop);
    wrap.querySelector("#mm-charsheet").innerHTML = _buildSheet(
      currentClass,
      currentRace,
    );
    wrap.querySelectorAll(".mm-cs-page").forEach((p, i) => {
      p.scrollTop = scrolls[i] ?? 0;
    });
    _rewire();
  };

  // Patch only ability boxes + points bar + HP in-place (no scroll jump)
  const _patchAbilities = () => {
    const raceDef = RACES.find((r) => r.id === currentRace) ?? RACES[0];
    const baseAbs = _character.baseAbs;
    const AB_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
    const pointsSpent = AB_KEYS.reduce(
      (s, k) => s + (PB_COSTS[baseAbs[k]] ?? 0),
      0,
    );
    const pointsLeft = PB_BUDGET - pointsSpent;

    const grid = wrap.querySelector("#mm-ability-grid");
    if (grid) {
      grid.querySelectorAll(".mm-ability-box--edit").forEach((box, i) => {
        const key = AB_KEYS[i];
        const baseVal = baseAbs[key];
        const racial = raceDef.bonuses[key] ?? 0;
        const finalVal = baseVal + racial;
        const curCost = PB_COSTS[baseVal] ?? 0;
        const nextCost = PB_COSTS[baseVal + 1] ?? 99;
        const canUp = baseVal < 15 && nextCost - curCost <= pointsLeft;
        const canDown = baseVal > 8;
        box.querySelector(".mm-ability-base").textContent = baseVal;
        box.querySelector(".mm-ability-final").textContent = finalVal;
        box.querySelector(".mm-ability-mod").textContent = _fmtMod(finalVal);
        const racialEl = box.querySelector(".mm-ability-racial");
        racialEl.textContent = racial > 0 ? `+${racial} racial` : "";
        const [btnDown, btnUp] = box.querySelectorAll(".mm-ability-btn");
        btnDown.disabled = !canDown;
        btnUp.disabled = !canUp;
      });
    }

    const pointsEl = wrap.querySelector(".mm-ab-points");
    if (pointsEl) {
      pointsEl.textContent = `${pointsLeft} / ${PB_BUDGET} pts remaining`;
      pointsEl.classList.toggle("mm-ab-points--done", pointsLeft === 0);
    }

    // Update HP if CON changed
    const hpValEl = wrap.querySelector(
      ".mm-cs-combat-box--hp .mm-cs-combat-val",
    );
    if (hpValEl) {
      const conFinal = baseAbs.con + (raceDef.bonuses.con ?? 0);
      const conMod = Math.floor((conFinal - 10) / 2);
      hpValEl.textContent = HIT_DICE[currentClass] + conMod;
    }
    // NOTE: No listener re-attachment here — _patchAbilities patches DOM values
    // in-place without replacing nodes, so the listeners from _rewire() survive.
  };

  // ── Initial render ────────────────────────────────────────────────────────
  wrap.innerHTML = `
    <div class="mm-bg-overlay"></div>
    <div class="mm-content mm-content--charsheet">
      <header class="mm-header mm-header--compact">
        <h1 class="mm-title">Forge Your Legend</h1>
        <p class="mm-tagline">Who faces the darkness?</p>
      </header>

      <div class="mm-cs-namebar">
        <div class="mm-cs-namebar-field">
          <label class="mm-cs-namebar-label">Character Name</label>
          <input id="mm-name" class="mm-cs-name-input mm-cs-namebar-input" type="text"
            placeholder="Enter your name…"
            value="${_escHtml(_character.name)}"
            maxlength="32" autocomplete="off" spellcheck="false" />
        </div>
      </div>

      <div class="mm-charsheet" id="mm-charsheet">
        ${_buildSheet(currentClass, currentRace)}
      </div>

      <footer class="mm-footer">
        <button id="mm-back"  class="mm-btn mm-btn--ghost" type="button">← Back</button>
        <button id="mm-start" class="mm-btn mm-btn--start" type="button">▶ Begin Adventure</button>
      </footer>
    </div>
  `;

  _rewire();
  setTimeout(() => wrap.querySelector("#mm-name")?.focus(), 80);

  wrap
    .querySelector("#mm-back")
    .addEventListener("click", () => _transition(1));

  wrap.querySelector("#mm-start").addEventListener("click", () => {
    _character.name =
      wrap.querySelector("#mm-name")?.value.trim() ?? _character.name;
    if (!_character.name) {
      const ni = wrap.querySelector("#mm-name");
      ni?.classList.add("mm-cs-name-input--error");
      ni?.focus();
      return;
    }
    const cls = currentClass;
    const raceDef = RACES.find((r) => r.id === currentRace) ?? RACES[0];
    const abs = { ..._character.baseAbs };
    for (const [k, v] of Object.entries(raceDef.bonuses)) {
      abs[k] = (abs[k] ?? 0) + v;
    }
    const hd = HIT_DICE[cls];
    const conMod = Math.floor((abs.con - 10) / 2);
    const maxHp = hd + conMod;
    const ac = BASE_AC[cls];
    const gold = STARTER_GOLD[cls];
    _resolve({
      campaignPath: _campaign.path,
      playerData: _buildPlayerData(cls, abs, maxHp, ac, gold, currentRace),
    });
  });
}

// ── Screen 3: Confirm & Start ─────────────────────────────────────────────────

function _renderConfirm(wrap) {
  const cls = _character.class;
  const race = _character.race ?? RACES[0].id;
  const raceDef = RACES.find((r) => r.id === race) ?? RACES[0];
  const rawAbs =
    _character.baseAbs ?? BASE_ABILITIES[cls] ?? BASE_ABILITIES.Fighter;
  const abs = { ...rawAbs };
  for (const [k, v] of Object.entries(raceDef.bonuses)) {
    abs[k] = (abs[k] ?? 0) + v;
  }
  const hd = HIT_DICE[cls] ?? 8;
  const conMod = Math.floor((abs.con - 10) / 2);
  const maxHp = hd + conMod;
  const ac = BASE_AC[cls] ?? 10 + Math.floor((abs.dex - 10) / 2);
  const gold = STARTER_GOLD[cls] ?? 20;
  const classDef = CLASSES.find((c) => c.id === cls) ?? CLASSES[0];

  const abilityCells = Object.entries(abs)
    .map(
      ([key, val]) => `
        <div class="mm-stat-cell">
          <span class="mm-stat-label">${key.toUpperCase()}</span>
          <span class="mm-stat-value">${val}</span>
          <span class="mm-stat-mod">${_fmtMod(val)}</span>
        </div>`,
    )
    .join("");

  const itemList = (STARTER_ITEMS[cls] ?? [])
    .map((i) => `<li class="mm-item">${i.name}</li>`)
    .join("");

  wrap.innerHTML = `
    <div class="mm-bg-overlay"></div>

    <div class="mm-content mm-content--narrow">
      <header class="mm-header">
        <h1 class="mm-title">${_escHtml(_character.name)}</h1>
        <p class="mm-tagline">${classDef.icon} ${cls} · ${raceDef.icon} ${race}</p>
      </header>

      <section class="mm-section">
        <div class="mm-stat-grid">${abilityCells}</div>

        <div class="mm-derived-row">
          <span class="mm-derived">❤️ <strong>${maxHp}</strong> HP</span>
          <span class="mm-derived">🛡 <strong>${ac}</strong> AC</span>
          <span class="mm-derived">🎲 d${hd} Hit Die</span>
          <span class="mm-derived">🪙 ${gold} gp</span>
        </div>

        ${
          itemList
            ? `
          <div class="mm-gear-row">
            <span class="mm-gear-label">🎒 Starting Gear</span>
            <ul class="mm-item-list">${itemList}</ul>
          </div>
        `
            : ""
        }
      </section>

      <footer class="mm-footer">
        <button id="mm-back" class="mm-btn mm-btn--ghost" type="button">← Back</button>
        <button id="mm-start" class="mm-btn mm-btn--start" type="button">
          ▶ Begin Adventure
        </button>
      </footer>
    </div>
  `;

  wrap
    .querySelector("#mm-back")
    .addEventListener("click", () => _transition(2));

  wrap.querySelector("#mm-start").addEventListener("click", () => {
    const playerData = _buildPlayerData(cls, abs, maxHp, ac, gold, race);
    _resolve({ campaignPath: _campaign.path, playerData });
  });
}

// ── Player data builder ───────────────────────────────────────────────────────

/**
 * Compose the full player store slice for the selected class.
 * initMana() and initEquipment() in bootstrap will apply spell slots and
 * equipment bonuses on top of this foundation.
 *
 * @param {string} cls
 * @param {object} abs     - ability scores
 * @param {number} maxHp
 * @param {number} ac
 * @param {number} gold
 * @returns {object}       - shape matches gameStore.player
 */
function _buildPlayerData(cls, abs, maxHp, ac, gold, race = RACES[0].id) {
  const items = (STARTER_ITEMS[cls] ?? []).map((item) => ({
    ...item,
    equipped: false,
  }));

  return {
    id: "player",
    name: _character.name,
    class: cls,
    race: race,
    level: 1,
    hp: maxHp,
    maxHp,
    ac,
    gold,
    proficiencyBonus: 2,
    abilities: { ...abs },
    attackBonus: 0,
    baseAc: null,
    baseMaxHp: null,
    baseMaxMana: null,
    mana: 0,
    maxMana: 0,
    knownSpells: [],
    inventory: items,
    equipment: { weapon: null, armor: null, accessory: null },
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    xp: 0,
    spellSlots: {},
    skills: {},
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _fmtMod(score) {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}

/** Minimal HTML-escape for user-entered character names. */
function _escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
