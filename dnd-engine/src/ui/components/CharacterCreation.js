/**
 * CharacterCreation.js
 *
 * Shows a character creation screen on first load.
 * On submit: writes the player slice of the store, then calls back so
 * bootstrap can start the first DM turn.
 */

import { gameStore } from "../../store/index.js";
import { CLASS_MANA, CLASS_SPELLS } from "../../data/spells.js";

const CLASSES = [
  "Barbarian",
  "Bard",
  "Cleric",
  "Druid",
  "Fighter",
  "Monk",
  "Paladin",
  "Ranger",
  "Rogue",
  "Sorcerer",
  "Warlock",
  "Wizard",
];

const RACES = [
  "Human",
  "Elf",
  "Dwarf",
  "Half-Orc",
  "Tiefling",
  "Halfling",
  "Gnome",
  "Dragonborn",
  "Half-Elf",
];

// Starting hit dice per class
const HIT_DICE = {
  Barbarian: 12,
  Fighter: 10,
  Paladin: 10,
  Ranger: 10,
  Cleric: 8,
  Druid: 8,
  Monk: 8,
  Rogue: 8,
  Warlock: 8,
  Bard: 8,
  Sorcerer: 6,
  Wizard: 6,
};

// ── Starter equipment kits ────────────────────────────────────────────────────
// itemIds that match EQUIPMENT_TEMPLATES will be equippable from the start.
// Potions must include healDice so useItem() heals properly.

/** @type {Record<string,{gold:number,items:object[]}>} */
const CLASS_STARTER_ITEMS = {
  Barbarian: {
    gold: 15,
    items: [
      {
        itemId: "iron_sword",
        name: "Iron Sword",
        quantity: 1,
        description: "+2 attack · 1d8 slashing",
        value: 15,
      },
      {
        itemId: "leather_armor",
        name: "Leather Armor",
        quantity: 1,
        description: "+2 AC",
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
  },
  Bard: {
    gold: 20,
    items: [
      {
        itemId: "shortsword",
        name: "Shortsword",
        quantity: 1,
        description: "+1 attack · 1d6 piercing · finesse",
        value: 10,
      },
      {
        itemId: "leather_armor",
        name: "Leather Armor",
        quantity: 1,
        description: "+2 AC",
        value: 10,
      },
      {
        itemId: "travellers_lute",
        name: "Traveller's Lute",
        quantity: 1,
        description: "A well-worn lute. Useful for coin and companionship.",
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
  },
  Cleric: {
    gold: 10,
    items: [
      {
        itemId: "staff_of_sparks",
        name: "Staff of Sparks",
        quantity: 1,
        description: "+1 attack · 1d6 · +2 Max MP",
        value: 20,
      },
      {
        itemId: "chain_mail",
        name: "Chain Mail",
        quantity: 1,
        description: "+4 AC",
        value: 30,
      },
      {
        itemId: "holy_symbol",
        name: "Holy Symbol",
        quantity: 1,
        description: "A small silver pendant. Focus for divine spellcasting.",
        value: 15,
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
  },
  Druid: {
    gold: 10,
    items: [
      {
        itemId: "staff_of_sparks",
        name: "Staff of Sparks",
        quantity: 1,
        description: "+1 attack · 1d6 · +2 Max MP",
        value: 20,
      },
      {
        itemId: "leather_armor",
        name: "Leather Armor",
        quantity: 1,
        description: "+2 AC",
        value: 10,
      },
      {
        itemId: "herb_pouch",
        name: "Herb Pouch",
        quantity: 1,
        description: "Dried healer's herbs. Smells of pine and rain.",
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
  },
  Fighter: {
    gold: 15,
    items: [
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
        value: 30,
      },
      {
        itemId: "shield",
        name: "Shield",
        quantity: 1,
        description: "+2 AC · off-hand slot",
        value: 15,
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
  },
  Monk: {
    gold: 5,
    items: [
      {
        itemId: "thieves_tools",
        name: "Thieves' Tools",
        quantity: 1,
        description: "+1 attack · 1d4 · finesse",
        value: 10,
      },
      {
        itemId: "monk_habit",
        name: "Monk's Habit",
        quantity: 1,
        description: "Simple robes. Unencumbering.",
        value: 2,
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
  },
  Paladin: {
    gold: 15,
    items: [
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
        value: 30,
      },
      {
        itemId: "shield",
        name: "Shield",
        quantity: 1,
        description: "+2 AC · off-hand slot",
        value: 15,
      },
      {
        itemId: "holy_symbol",
        name: "Holy Symbol",
        quantity: 1,
        description: "A small silver pendant. Divine casting focus.",
        value: 15,
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
  },
  Ranger: {
    gold: 15,
    items: [
      {
        itemId: "shortsword",
        name: "Shortsword",
        quantity: 1,
        description: "+1 attack · 1d6 piercing · finesse",
        value: 10,
      },
      {
        itemId: "leather_armor",
        name: "Leather Armor",
        quantity: 1,
        description: "+2 AC",
        value: 10,
      },
      {
        itemId: "shortbow",
        name: "Shortbow",
        quantity: 1,
        description: "+2 attack · 1d6 ranged · uses arrows",
        value: 25,
      },
      {
        itemId: "arrow",
        name: "Arrow",
        quantity: 20,
        description: "Standard arrows.",
        value: 1,
        ammoType: "arrow",
      },
      {
        itemId: "ranger_kit",
        name: "Ranger's Field Kit",
        quantity: 1,
        description: "Rope, flint, and dried rations. Leave no trace.",
        value: 8,
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
  },
  Rogue: {
    gold: 20,
    items: [
      {
        itemId: "thieves_tools",
        name: "Thieves' Tools",
        quantity: 1,
        description: "+1 attack · 1d4 · finesse",
        value: 10,
      },
      {
        itemId: "leather_armor",
        name: "Leather Armor",
        quantity: 1,
        description: "+2 AC",
        value: 10,
      },
      {
        itemId: "shortsword",
        name: "Shortsword",
        quantity: 1,
        description: "+1 attack · 1d6 piercing · finesse",
        value: 10,
      },
      {
        itemId: "offhand_dagger",
        name: "Dagger (Off-hand)",
        quantity: 1,
        description: "+1 attack · 1d4 finesse · sidearm",
        value: 8,
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
  },
  Sorcerer: {
    gold: 10,
    items: [
      {
        itemId: "staff_of_sparks",
        name: "Staff of Sparks",
        quantity: 1,
        description: "+1 attack · 1d6 · +2 Max MP",
        value: 20,
      },
      {
        itemId: "mage_robe",
        name: "Mage's Robe",
        quantity: 1,
        description: "+1 AC · +5 Max MP",
        value: 20,
      },
      {
        itemId: "arcane_focus",
        name: "Arcane Focus",
        quantity: 1,
        description: "A smooth orb of pale crystal. Spellcasting focus.",
        value: 15,
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
  },
  Warlock: {
    gold: 10,
    items: [
      {
        itemId: "staff_of_sparks",
        name: "Staff of Sparks",
        quantity: 1,
        description: "+1 attack · 1d6 · +2 Max MP",
        value: 20,
      },
      {
        itemId: "mage_robe",
        name: "Mage's Robe",
        quantity: 1,
        description: "+1 AC · +5 Max MP",
        value: 20,
      },
      {
        itemId: "infernal_tome",
        name: "Infernal Tome",
        quantity: 1,
        description:
          "Crackling pages bound in dark leather. Your patron speaks through it.",
        value: 20,
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
  },
  Wizard: {
    gold: 10,
    items: [
      {
        itemId: "staff_of_sparks",
        name: "Staff of Sparks",
        quantity: 1,
        description: "+1 attack · 1d6 · +2 Max MP",
        value: 20,
      },
      {
        itemId: "mage_robe",
        name: "Mage's Robe",
        quantity: 1,
        description: "+1 AC · +5 Max MP",
        value: 20,
      },
      {
        itemId: "spellbook",
        name: "Spellbook",
        quantity: 1,
        description:
          "Pages dense with arcane notation. Worth more than your life.",
        value: 50,
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
  },
};

/** @type {Record<string,{gold:number,items:object[]}>} */
const RACE_STARTER_ITEMS = {
  Human: {
    gold: 10,
    items: [
      {
        itemId: "travelers_pack",
        name: "Traveller's Pack",
        quantity: 1,
        description:
          "A sturdy pack holding everything a human needs to get started.",
        value: 5,
      },
    ],
  },
  Elf: {
    gold: 5,
    items: [
      {
        itemId: "elven_bread",
        name: "Elven Waybread",
        quantity: 2,
        description: "Lembas-like travel bread. One bite is enough.",
        value: 5,
      },
      {
        itemId: "elven_cloak",
        name: "Elven Cloak",
        quantity: 1,
        description:
          "Woven from grey leaves. Almost makes you invisible at dusk.",
        value: 15,
      },
    ],
  },
  Dwarf: {
    gold: 5,
    items: [
      {
        itemId: "stonebrew_flask",
        name: "Stonebrew Flask",
        quantity: 1,
        description: "Dwarven spirits. Burns like a forge.",
        value: 3,
      },
      {
        itemId: "mining_pick",
        name: "Mining Pick",
        quantity: 1,
        description: "Handy for revealing what rocks hide.",
        value: 5,
      },
    ],
  },
  "Half-Orc": {
    gold: 5,
    items: [
      {
        itemId: "health_potion_minor",
        name: "Minor Healing Potion",
        quantity: 1,
        description: "Restores 2d4+2 HP.",
        value: 25,
        healDice: "2d4+2",
      },
      {
        itemId: "war_trophy",
        name: "War Trophy",
        quantity: 1,
        description:
          "A broken enemy helmet worn as a belt ornament. Intimidating.",
        value: 2,
      },
    ],
  },
  Tiefling: {
    gold: 5,
    items: [
      {
        itemId: "infernal_charm",
        name: "Infernal Charm",
        quantity: 1,
        description:
          "Small brass talisman. Warm to the touch. Wards off minor curses.",
        value: 10,
      },
    ],
  },
  Halfling: {
    gold: 10,
    items: [
      {
        itemId: "lucky_charm",
        name: "Lucky Charm",
        quantity: 1,
        description: "A rabbit's foot worn smooth. You've never questioned it.",
        value: 1,
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
  },
  Gnome: {
    gold: 10,
    items: [
      {
        itemId: "clockwork_trinket",
        name: "Clockwork Trinket",
        quantity: 1,
        description:
          "A tiny wind-up bird that ticks. You made it. You're proud of it.",
        value: 5,
      },
    ],
  },
  Dragonborn: {
    gold: 5,
    items: [
      {
        itemId: "dragonscale_shard",
        name: "Dragonscale Shard",
        quantity: 1,
        description:
          "A fragment of ancestral scale. A reminder of what you carry.",
        value: 10,
      },
    ],
  },
  "Half-Elf": {
    gold: 10,
    items: [
      {
        itemId: "diplomatic_seal",
        name: "Diplomatic Seal",
        quantity: 1,
        description:
          "An official-looking wax seal. Opens some doors. Closes others.",
        value: 8,
      },
    ],
  },
};

/**
 * Mount the character creation screen into a container element.
 *
 * @param {HTMLElement} container  - Where to render
 * @param {Function}    onComplete - Called with created player data after submit
 */
export function mountCharacterCreation(container, onComplete) {
  container.innerHTML = `
    <div class="creation-overlay">
      <div class="creation-card">
        <h2 class="creation-title">Create Your Character</h2>

        <div class="creation-form">
          <label class="form-label">
            Name
            <input
              id="char-name"
              class="form-input"
              type="text"
              placeholder="Aldric Ashmore"
              maxlength="40"
              autocomplete="off"
            />
          </label>

          <div class="form-row">
            <label class="form-label">
              Class
              <select id="char-class" class="form-select">
                ${CLASSES.map((c) => `<option value="${c}">${c}</option>`).join("")}
              </select>
            </label>
            <label class="form-label">
              Race
              <select id="char-race" class="form-select">
                ${RACES.map((r) => `<option value="${r}">${r}</option>`).join("")}
              </select>
            </label>
          </div>

          <div class="ability-grid" id="ability-grid">
            <!-- Rendered by JS below -->
          </div>

          <div class="stat-preview" id="stat-preview"></div>

          <button id="btn-begin" class="btn-primary btn-begin">⚔️ Begin Adventure</button>
        </div>
      </div>
    </div>
  `;

  // Default abilities (standard array)
  const abilities = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
  renderAbilityGrid(abilities);
  updateStatPreview(abilities, "Fighter");

  // Update preview when class changes
  document.getElementById("char-class").addEventListener("change", (e) => {
    const current = readAbilities();
    updateStatPreview(current, e.target.value);
  });

  // Update preview when any ability changes
  document.getElementById("ability-grid").addEventListener("input", () => {
    const current = readAbilities();
    updateStatPreview(current, document.getElementById("char-class").value);
  });

  // Submit
  document.getElementById("btn-begin").addEventListener("click", () => {
    const name =
      document.getElementById("char-name").value.trim() || "Adventurer";
    const cls = document.getElementById("char-class").value;
    const race = document.getElementById("char-race").value;
    const abs = readAbilities();

    const conMod = Math.floor((abs.con - 10) / 2);
    const hd = HIT_DICE[cls] ?? 8;
    const maxHp = hd + conMod;
    const maxMana = CLASS_MANA[cls] ?? 0;
    const knownSpells = CLASS_SPELLS[cls] ?? [];

    // Build starter inventory from class kit + race kit
    const classKit = CLASS_STARTER_ITEMS[cls] ?? { gold: 0, items: [] };
    const raceKit = RACE_STARTER_ITEMS[race] ?? { gold: 0, items: [] };
    const starterInventory = [...classKit.items, ...raceKit.items].map(
      (item) => ({
        equipped: false,
        quantity: 1,
        ...item,
      }),
    );
    const starterGold = 10 + (classKit.gold ?? 0) + (raceKit.gold ?? 0);

    const player = {
      ...gameStore.getState().player,
      id: crypto.randomUUID(),
      name,
      class: cls,
      race,
      level: 1,
      hp: maxHp,
      maxHp,
      ac: 10 + Math.floor((abs.dex - 10) / 2),
      gold: starterGold,
      proficiencyBonus: 2,
      abilities: abs,
      mana: maxMana,
      maxMana,
      knownSpells,
      inventory: starterInventory,
    };

    gameStore.setState(
      {
        player,
        session: {
          ...gameStore.getState().session,
          localPlayerId: player.id,
          currentTurnPlayerId: player.id,
          isMyTurn: true,
        },
      },
      "characterCreation",
    );

    // Clear the overlay
    container.innerHTML = "";

    onComplete(player);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ABILITY_LABELS = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};

function renderAbilityGrid(abilities) {
  const grid = document.getElementById("ability-grid");
  if (!grid) return;

  grid.innerHTML = Object.entries(ABILITY_LABELS)
    .map(
      ([key, label]) => `
    <div class="ability-cell">
      <label class="ability-label">${label}</label>
      <input
        class="ability-input"
        data-ability="${key}"
        type="number"
        min="3" max="20"
        value="${abilities[key]}"
      />
      <span class="ability-mod">${fmtMod(abilities[key])}</span>
    </div>
  `,
    )
    .join("");

  // Live mod update
  grid.querySelectorAll(".ability-input").forEach((input) => {
    input.addEventListener("input", () => {
      const mod = input.nextElementSibling;
      if (mod) mod.textContent = fmtMod(parseInt(input.value) || 10);
    });
  });
}

function readAbilities() {
  const abs = {};
  document.querySelectorAll(".ability-input").forEach((input) => {
    abs[input.dataset.ability] = Math.min(
      20,
      Math.max(3, parseInt(input.value) || 10),
    );
  });
  return abs;
}

function updateStatPreview(abs, cls) {
  const preview = document.getElementById("stat-preview");
  if (!preview) return;

  const hd = HIT_DICE[cls] ?? 8;
  const conMod = Math.floor((abs.con - 10) / 2);
  const dexMod = Math.floor((abs.dex - 10) / 2);
  const maxHp = hd + conMod;
  const ac = 10 + dexMod;
  const kit = CLASS_STARTER_ITEMS[cls] ?? { gold: 0, items: [] };
  const startGold = 10 + kit.gold;
  const kitNames = kit.items.map((i) => i.name).join(", ");

  preview.innerHTML = `
    <span class="preview-stat">❤️ ${maxHp} HP</span>
    <span class="preview-stat">🛡 ${ac} AC</span>
    <span class="preview-stat">🎲 d${hd} hit die</span>
    <span class="preview-stat">🪙 ${startGold}+ gp</span>
    ${kitNames ? `<span class="preview-kit">🎒 ${kitNames}</span>` : ""}
  `;
}

function fmtMod(score) {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}
