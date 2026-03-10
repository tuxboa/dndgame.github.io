/**
 * encounters.js — Hardcoded static encounters for testing.
 *
 * These bypass the AI DM entirely. Each encounter definition carries full
 * combat stats so `startCombat()` needs zero template lookups.
 *
 * HOW TO ADD AN ENCOUNTER
 * ──────────────────────────────────────────────────────────────────────────
 * 1. Add an entry to ENCOUNTERS below.
 * 2. Each `enemies[]` entry is a full CombatParticipant — all fields required
 *    by turnManager.runEnemyTurn() must be present.
 * 3. Call `startStaticEncounter("your_id")` from anywhere to begin combat.
 * ──────────────────────────────────────────────────────────────────────────
 */

import { gameStore } from "../store/index.js";
import { startCombat } from "../systems/turnManager.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { EQUIPMENT_TEMPLATES } from "./equipment.js";

// ── Encounter definitions ─────────────────────────────────────────────────────

/**
 * @typedef {Object} EncounterDef
 * @property {string}   id
 * @property {string}   name
 * @property {string}   description
 * @property {string}   difficulty   - "Trivial" | "Easy" | "Medium" | "Hard" | "Deadly"
 * @property {string}   flavor       - Short read-aloud text shown when encounter starts
 * @property {EnemyDef[]} enemies
 */

/**
 * @typedef {Object} EnemyDef
 * @property {string}  id
 * @property {string}  name
 * @property {number}  hp
 * @property {number}  maxHp
 * @property {number}  ac
 * @property {number}  initiativeModifier
 * @property {number}  attackBonus
 * @property {string}  damageDie          - e.g. "1d6+2"
 * @property {number}  xpReward
 * @property {number}  goldReward
 * @property {string[]} lootTable         - item names; each has 33% drop chance
 */

export const ENCOUNTERS = {
  // ── Encounter 1: Tutorial ──────────────────────────────────────────────────
  giant_rat_den: {
    id: "giant_rat_den",
    name: "Giant Rat Den",
    description: "Two diseased giant rats block the tunnel ahead.",
    difficulty: "Trivial",
    repeatable: true,
    mapType: "sewer",
    flavor:
      "The stench of rot fills the narrow passage. Two giant rats, eyes gleaming with unnatural hunger, skitter toward you.",
    enemies: [
      {
        id: "rat_1",
        name: "Giant Rat",
        hp: 7,
        maxHp: 7,
        ac: 11,
        initiativeModifier: 2,
        attackBonus: 4,
        damageDie: "1d4+2",
        xpReward: 25,
        goldReward: 0,
        lootTable: [],
      },
      {
        id: "rat_2",
        name: "Giant Rat",
        hp: 7,
        maxHp: 7,
        ac: 11,
        initiativeModifier: 2,
        attackBonus: 4,
        damageDie: "1d4+2",
        xpReward: 25,
        goldReward: 0,
        lootTable: [],
      },
    ],
  },

  // ── Encounter 2: Easy ─────────────────────────────────────────────────────
  goblin_scouts: {
    id: "goblin_scouts",
    name: "Goblin Scouts",
    description: "Three goblin scouts armed with short bows.",
    difficulty: "Easy",
    repeatable: true,
    mapType: "forest",
    flavor:
      "High-pitched cackles echo from the shadows. Three goblins in leather armour fan out, arrows already nocked.",
    enemies: [
      {
        id: "goblin_1",
        name: "Goblin Scout",
        hp: 10,
        maxHp: 10,
        ac: 13,
        initiativeModifier: 2,
        attackBonus: 4,
        damageDie: "1d6+2",
        xpReward: 50,
        goldReward: 3,
        lootTable: ["Short Sword", "Leather Pouch"],
      },
      {
        id: "goblin_2",
        name: "Goblin Scout",
        hp: 10,
        maxHp: 10,
        ac: 13,
        initiativeModifier: 2,
        attackBonus: 4,
        damageDie: "1d6+2",
        xpReward: 50,
        goldReward: 3,
        lootTable: ["Arrow Bundle"],
      },
      {
        id: "goblin_3",
        name: "Goblin Scout",
        hp: 12,
        maxHp: 12,
        ac: 13,
        initiativeModifier: 2,
        attackBonus: 5,
        damageDie: "1d6+3",
        xpReward: 75,
        goldReward: 5,
        lootTable: ["Short Sword", "Health Potion"],
      },
    ],
  },

  // ── Encounter 3: Medium ───────────────────────────────────────────────────
  bandit_ambush: {
    id: "bandit_ambush",
    name: "Bandit Ambush",
    description: "Two bandits and their scarred sergeant.",
    difficulty: "Medium",
    repeatable: true,
    mapType: "road",
    flavor:
      '"Your coin or your life!" A gruff voice cuts through the dark. Two crossbowmen step out of the treeline while a battle-scarred sergeant draws her blade.',
    enemies: [
      {
        id: "bandit_1",
        name: "Bandit",
        hp: 11,
        maxHp: 11,
        ac: 12,
        initiativeModifier: 1,
        attackBonus: 3,
        damageDie: "1d6+1",
        xpReward: 50,
        goldReward: 5,
        lootTable: ["Crossbow Bolt ×10", "Leather Armor"],
      },
      {
        id: "bandit_2",
        name: "Bandit",
        hp: 11,
        maxHp: 11,
        ac: 12,
        initiativeModifier: 1,
        attackBonus: 3,
        damageDie: "1d6+1",
        xpReward: 50,
        goldReward: 5,
        lootTable: ["Dagger"],
      },
      {
        id: "bandit_sergeant",
        name: "Bandit Sergeant",
        hp: 26,
        maxHp: 26,
        ac: 15,
        initiativeModifier: 2,
        attackBonus: 5,
        damageDie: "1d8+3",
        xpReward: 100,
        goldReward: 20,
        lootTable: ["Chain Shirt", "Health Potion", "Sergeant's Signet Ring"],
      },
    ],
  },

  // ── Encounter 4: Hard ─────────────────────────────────────────────────────
  young_guard_captain: {
    id: "young_guard_captain",
    name: "Ironhold Guard Patrol",
    description: "A veteran guard captain and two elite soldiers.",
    difficulty: "Hard",
    mapType: "cobblestone",
    flavor:
      'Ironhold tabards. The captain\'s plate gleams in the torchlight. "Halt, intruder. You will not leave this courtyard."',
    enemies: [
      {
        id: "guard_1",
        name: "Elite Guard",
        hp: 19,
        maxHp: 19,
        ac: 16,
        initiativeModifier: 1,
        attackBonus: 4,
        damageDie: "1d8+2",
        xpReward: 100,
        goldReward: 8,
        lootTable: ["Longsword", "Shield", "Guard's Helm"],
      },
      {
        id: "guard_2",
        name: "Elite Guard",
        hp: 19,
        maxHp: 19,
        ac: 16,
        initiativeModifier: 1,
        attackBonus: 4,
        damageDie: "1d8+2",
        xpReward: 100,
        goldReward: 8,
        lootTable: ["Longsword", "Chain Mail"],
      },
      {
        id: "guard_captain",
        name: "Guard Captain",
        hp: 52,
        maxHp: 52,
        ac: 18,
        initiativeModifier: 3,
        attackBonus: 7,
        damageDie: "1d8+4",
        xpReward: 450,
        goldReward: 50,
        lootTable: [
          "Captain's Longsword",
          "Full Plate Fragment",
          "Ironhold Garrison Key",
          "Health Potion",
        ],
      },
    ],
  },

  // ── Encounter 5: Solo boss ────────────────────────────────────────────────
  ironclad_sentinel: {
    id: "ironclad_sentinel",
    name: "Ironclad Sentinel",
    description: "A construct guardian left to patrol a forgotten vault.",
    difficulty: "Deadly",
    mapType: "boss_room",
    flavor:
      'The grinding of ancient gears echoes off stone walls. Twin amber eyes ignite. The sentinel\'s voice is mechanical and cold: "INTRUDER DETECTED."',
    enemies: [
      {
        id: "sentinel",
        name: "Ironclad Sentinel",
        hp: 85,
        maxHp: 85,
        ac: 19,
        initiativeModifier: 0,
        attackBonus: 8,
        damageDie: "2d8+5",
        xpReward: 1100,
        goldReward: 0,
        lootTable: [
          "Arcane Core Fragment",
          "Construct Plating",
          "Vault Sigil Key",
        ],
      },
    ],
  },

  // ── Encounter 6: Free Clan Road Scouts ────────────────────────────────────
  free_clan_scouts: {
    id: "free_clan_scouts",
    name: "Free Clan Scouts",
    description: "Three wiry scouts of the Free Clans move to cut you off.",
    difficulty: "Easy",
    repeatable: true,
    mapType: "grassland",
    flavor:
      "Leather armour, no insignia, fast eyes. The lead scout raises a hand — the others spread to flank. 'Ironhold coin in your bag, stranger? Or just passing through?'",
    enemies: [
      {
        id: "scout_1",
        name: "Clan Scout",
        hp: 11,
        maxHp: 11,
        ac: 13,
        initiativeModifier: 3,
        attackBonus: 3,
        damageDie: "1d6+2",
        xpReward: 50,
        goldReward: 4,
        lootTable: ["Clan Sigil Badge"],
      },
      {
        id: "scout_2",
        name: "Clan Scout",
        hp: 11,
        maxHp: 11,
        ac: 13,
        initiativeModifier: 3,
        attackBonus: 3,
        damageDie: "1d6+2",
        xpReward: 50,
        goldReward: 4,
        lootTable: [],
      },
      {
        id: "scout_leader",
        name: "Clan Scout Leader",
        hp: 17,
        maxHp: 17,
        ac: 14,
        initiativeModifier: 2,
        attackBonus: 4,
        damageDie: "1d8+2",
        xpReward: 100,
        goldReward: 8,
        lootTable: ["Clan Orders (Sealed)"],
      },
    ],
  },

  // ── Encounter 7: Cultist Ambush ───────────────────────────────────────────
  cultist_ambush: {
    id: "cultist_ambush",
    name: "Cultist Ambush",
    description: "Robed figures emerge from the shadows, blades drawn.",
    difficulty: "Medium",
    repeatable: true,
    mapType: "forest",
    flavor:
      "Dark robes. Pale faces. They step out of the roadside shadows without a sound. The leader tilts his head at an angle that isn't quite human. 'The shard calls to us.'",
    enemies: [
      {
        id: "cultist_1",
        name: "Cultist",
        hp: 9,
        maxHp: 9,
        ac: 12,
        initiativeModifier: 1,
        attackBonus: 2,
        damageDie: "1d6+1",
        xpReward: 50,
        goldReward: 2,
        lootTable: [],
      },
      {
        id: "cultist_2",
        name: "Cultist",
        hp: 9,
        maxHp: 9,
        ac: 12,
        initiativeModifier: 1,
        attackBonus: 2,
        damageDie: "1d6+1",
        xpReward: 50,
        goldReward: 2,
        lootTable: [],
      },
      {
        id: "cultist_zealot",
        name: "Cult Zealot",
        hp: 18,
        maxHp: 18,
        ac: 13,
        initiativeModifier: 0,
        attackBonus: 4,
        damageDie: "1d8+2",
        xpReward: 150,
        goldReward: 5,
        lootTable: ["Silver Circle Cipher", "Zealot's Dagger"],
      },
    ],
  },

  // ── Encounter 8: Orc Warband ──────────────────────────────────────────────
  orc_warband: {
    id: "orc_warband",
    name: "Orc Warband",
    description: "A small orc raiding party, emboldened by recent victories.",
    difficulty: "Hard",
    repeatable: true,
    mapType: "grassland",
    flavor:
      "The ground shakes before you see them. Three orcs step out of the scrubland — tusks scarred, armour stripped from corpses, war-paint fresh. No words. No warning.",
    enemies: [
      {
        id: "orc_1",
        name: "Orc Warrior",
        hp: 15,
        maxHp: 15,
        ac: 13,
        initiativeModifier: 1,
        attackBonus: 3,
        damageDie: "1d8+3",
        xpReward: 100,
        goldReward: 5,
        lootTable: [],
      },
      {
        id: "orc_2",
        name: "Orc Warrior",
        hp: 15,
        maxHp: 15,
        ac: 13,
        initiativeModifier: 1,
        attackBonus: 3,
        damageDie: "1d8+3",
        xpReward: 100,
        goldReward: 5,
        lootTable: [],
      },
      {
        id: "orc_warchief",
        name: "Orc Warchief",
        hp: 30,
        maxHp: 30,
        ac: 14,
        initiativeModifier: 1,
        attackBonus: 5,
        damageDie: "1d12+4",
        xpReward: 250,
        goldReward: 15,
        lootTable: ["Iron Clan Banner", "Warchief's Axe"],
      },
    ],
  },
};

// ── Difficulty colors ────────────────────────────────────────────────────────

export const DIFFICULTY_COLOUR = {
  Trivial: "#6b7280",
  Easy: "#22c55e",
  Medium: "#eab308",
  Hard: "#f97316",
  Deadly: "#ef4444",
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a hardcoded static encounter immediately.
 * Builds CombatParticipant[] from encounter def + current player state,
 * then calls startCombat() directly — no AI or COMBAT_REQUESTED needed.
 *
 * @param {string} encounterId - Key in ENCOUNTERS
 * @returns {boolean} false if encounter not found or combat already active
 */
export function startStaticEncounter(encounterId) {
  const encounter = ENCOUNTERS[encounterId];
  if (!encounter) {
    console.warn(`[Encounters] Unknown encounter id: "${encounterId}"`);
    return false;
  }

  const state = gameStore.getState();
  console.log(
    `[Encounters] startStaticEncounter("${encounterId}") — combat.active=${state.combat.active}, player.hp=${state.player.hp}/${state.player.maxHp}`,
  );

  // Skip if encounter was already cleared — unless it's marked as repeatable
  if (
    !encounter.repeatable &&
    state.world.storyFlags?.[`cleared_${encounterId}`]
  ) {
    console.log(
      `[Encounters] "${encounterId}" already cleared — skipping combat.`,
    );
    return false;
  }

  if (state.combat.active) {
    console.warn(
      "[Encounters] Combat already active — force-resetting and starting new encounter.",
    );
    // Force-clear stale combat state so the encounter can proceed
    gameStore.setState(
      {
        combat: {
          ...gameStore.getState().combat,
          active: false,
          turnOrder: [],
          round: 0,
        },
      },
      "encounters:forceClearStaleCombat",
    );
  }

  // Build the player participant from live store data
  const p = gameStore.getState().player; // re-read after possible reset
  const strMod = Math.floor(((p.abilities?.str ?? 10) - 10) / 2);
  const dexMod = Math.floor(((p.abilities?.dex ?? 10) - 10) / 2);

  // Guard: player must have at least 1 HP to enter combat
  if ((p.hp ?? 0) <= 0) {
    console.warn(
      `[Encounters] Player has ${p.hp} HP — setting to 1 before combat starts`,
    );
    gameStore.setState(
      { player: { ...p, hp: 1 } },
      "encounters:ensurePlayerHp",
    );
  }

  const freshPlayer = gameStore.getState().player;

  const playerParticipant = {
    id: freshPlayer.id ?? "player",
    name: freshPlayer.name || "Adventurer",
    isPlayer: true,
    playerId: gameStore.getState().session.localPlayerId,
    hp: freshPlayer.hp,
    maxHp: freshPlayer.maxHp || freshPlayer.hp || 1,
    ac: freshPlayer.ac,
    initiativeModifier: dexMod,
    attackBonus: strMod + (freshPlayer.proficiencyBonus ?? 2),
    damageDie: _equippedDamageDie(freshPlayer),
  };

  // ── Encounter scaling: enemies grow with player level ──────────────────────
  // Each level beyond 1 adds 20% HP and +1 attack bonus every 2 levels.
  const playerLevel = freshPlayer.level ?? 1;
  const hpScale = 1 + (playerLevel - 1) * 0.2;
  const atkScale = Math.floor((playerLevel - 1) / 2);

  // Build enemy participants — clone to avoid mutating the source definition
  const enemyParticipants = encounter.enemies.map((e) => {
    const baseHp = e.maxHp ?? e.hp ?? 10;
    const scaledHp = Math.max(1, Math.round(baseHp * hpScale));
    return {
      ...e,
      hp: scaledHp,
      maxHp: scaledHp,
      attackBonus: (e.attackBonus ?? 0) + atkScale,
      isPlayer: false,
      playerId: null,
      // Preserve xpReward/goldReward/lootTable so turnManager can award them
    };
  });

  const participants = [playerParticipant, ...enemyParticipants];

  // Push flavor text into the narrative log (main.js subscribes to this slice)
  const currentDm = gameStore.getState().dm;
  gameStore.setState(
    {
      dm: {
        ...currentDm,
        narrativeLog: [
          ...(currentDm.narrativeLog ?? []),
          { role: "dm", text: encounter.flavor, timestamp: Date.now() },
        ],
      },
    },
    "encounters:flavor",
  );

  // Toast notification for encounter name + difficulty
  eventBus.emit(EVENTS.UI_NOTIFICATION, {
    text: `⚔️ ${encounter.name} — ${encounter.difficulty}`,
    type: "info",
    ttl: 3000,
  });

  console.log(
    "[Encounters] Calling startCombat with participants:",
    participants.map((p) => `${p.name}(hp:${p.hp}/${p.maxHp})`),
  );
  try {
    // Inject encounter mapType into combat.map BEFORE startCombat so
    // CombatMapEngine can pick it up the moment COMBAT_STARTED fires
    if (encounter.mapType) {
      const cs = gameStore.getState();
      gameStore.setState(
        {
          combat: {
            ...cs.combat,
            map: { ...cs.combat.map, mapType: encounter.mapType },
          },
        },
        "encounters:setMapType",
      );
    }
    startCombat(participants);
  } catch (err) {
    console.error("[Encounters] startCombat CRASHED:", err);
    return false;
  }

  // Mark non-repeatable encounters as cleared on victory so they don't repeat
  eventBus.once(EVENTS.COMBAT_VICTORY, () => {
    if (encounter.repeatable) {
      console.log(
        `[Encounters] "${encounterId}" is repeatable — not marking cleared.`,
      );
      return;
    }
    const s = gameStore.getState();
    gameStore.setState(
      {
        world: {
          ...s.world,
          storyFlags: {
            ...(s.world.storyFlags ?? {}),
            [`cleared_${encounterId}`]: true,
          },
        },
      },
      "encounters:markCleared",
    );
    console.log(`[Encounters] Marked "${encounterId}" as cleared.`);
  });

  return true;
}

/**
 * Return a sorted list of all encounters (by difficulty order) for UI display.
 * @returns {EncounterDef[]}
 */
export function listEncounters() {
  const order = ["Trivial", "Easy", "Medium", "Hard", "Deadly"];
  return Object.values(ENCOUNTERS).sort(
    (a, b) => order.indexOf(a.difficulty) - order.indexOf(b.difficulty),
  );
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _equippedDamageDie(player) {
  // Prefer the new equipment slot system
  const weaponId = player.equipment?.weapon?.itemId;
  if (weaponId) {
    const tpl = EQUIPMENT_TEMPLATES[weaponId];
    if (tpl?.bonuses?.damageDie) return tpl.bonuses.damageDie;
  }
  // Fallback: legacy inventory-based equipped weapon
  const weapon = player.inventory?.find(
    (i) => i.equipped && i.type === "weapon",
  );
  if (weapon?.damageNotation) return weapon.damageNotation;
  if (weapon?.damageDie) return weapon.damageDie;
  return "1d4"; // unarmed
}
