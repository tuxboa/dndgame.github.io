/**
 * convertCampaign.js
 *
 * Converts a Fantasy Grounds Unity db.xml (D&D 5e module) to the
 * campaign.json format consumed by campaignLoader.js.
 *
 * Tested against the "A Great Upheaval" FGU module structure.
 *
 * Usage:
 *   node scripts/convertCampaign.js [--xml <path>] [--out <path>]
 *
 * Defaults:
 *   --xml  engine/DDLE5_-_A_Great_Upheaval/db.xml
 *   --out  public/campaigns/campaign.json
 */
/* global process */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { XMLParser } from "fast-xml-parser";

// ── Paths ──────────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const args = process.argv.slice(2);
const xmlArg = args.indexOf("--xml");
const outArg = args.indexOf("--out");

const XML_PATH =
  xmlArg !== -1
    ? resolve(args[xmlArg + 1])
    : resolve(ROOT, "engine", "DDLE5_-_A_Great_Upheaval", "db.xml");

const OUT_PATH =
  outArg !== -1
    ? resolve(args[outArg + 1])
    : resolve(ROOT, "public", "campaigns", "campaign.json");

// ── CR → XP table (D&D 5e PHB) ────────────────────────────────────────────────

const CR_XP = {
  0: 10,
  "1/8": 25,
  "1/4": 50,
  "1/2": 100,
  1: 200,
  2: 450,
  3: 700,
  4: 1100,
  5: 1800,
  6: 2300,
  7: 2900,
  8: 3900,
  9: 5000,
  10: 5900,
  11: 7200,
  12: 8400,
  13: 10000,
  14: 11500,
  15: 13000,
  16: 15000,
  17: 18000,
  18: 20000,
  19: 22000,
  20: 25000,
};

// CR → rough proficiency bonus for attack fallback
const CR_PROF = {
  0: 2,
  "1/8": 2,
  "1/4": 2,
  "1/2": 2,
  1: 2,
  2: 2,
  3: 2,
  4: 2,
  5: 3,
  6: 3,
  7: 3,
  8: 3,
  9: 4,
  10: 4,
  11: 4,
  12: 4,
  13: 5,
  14: 5,
  15: 5,
  16: 5,
  17: 6,
  18: 6,
  19: 6,
  20: 6,
};

// Best-effort sprite mapping from creature type/name keywords
const SPRITE_MAP = [
  [/dragon/i, "dragon"],
  [/undead|zombie|skeleton|ghoul|wight|vampire/i, "undead"],
  [/construct|golem|automaton|shield guardian/i, "construct"],
  [/elemental/i, "elemental"],
  [/fiend|demon|devil|imp|succubus/i, "fiend"],
  [/giant|ogre|troll/i, "giant"],
  [/goblin/i, "goblin"],
  [/hobgoblin/i, "hobgoblin"],
  [/orc/i, "orc"],
  [/gnoll/i, "gnoll"],
  [/bandit|thug|rogue|spy|assassin/i, "bandit"],
  [/scout|ranger|hunter/i, "goblin"],
  [/guard|soldier|fighter|knight/i, "guard"],
  [/mage|wizard|sorcerer|warlock|witch/i, "mage"],
  [/cleric|priest|cultist/i, "cleric"],
  [/wolf|bear|lion|tiger|panther|beast/i, "beast"],
  [/swarm/i, "swarm"],
];

// ── XML Parser config ──────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // FGU uses type="" attributes extensively — preserve them
  parseAttributeValue: false,
  // Don't collapse text nodes — we want #text content
  trimValues: true,
  // Keep numeric strings as strings so we handle them ourselves
  parseNodeValue: false,
  // Tags may contain ids like id-00001 — do NOT deduplicate them
  isArray: (tagName) => /^id-\d+$/.test(tagName),
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Return numeric value regardless of FGU's type="number" wrapper */
function num(val, fallback = 0) {
  if (val === undefined || val === null) return fallback;
  // fast-xml-parser can return objects like { "#text": "7", "@_type": "number" }
  const raw = typeof val === "object" ? (val["#text"] ?? val) : val;
  const n = Number(raw);
  return isNaN(n) ? fallback : n;
}

/** Return string value from an FGU node (may be { "#text": "...", "@_type": ... }) */
function str(val, fallback = "") {
  if (val === undefined || val === null) return fallback;
  if (typeof val === "string") return val.trim();
  if (typeof val === "object") {
    return String(val["#text"] ?? val["@_value"] ?? "").trim();
  }
  return String(val).trim();
}

/** Strip FGU FormattedText XML tags and return plain text */
function plainText(val) {
  const raw = str(val);
  return raw
    .replace(/<\/?[^>]+>/g, " ") // strip XML/HTML tags
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Convert all id-keyed children of a node into a flat array */
function idEntries(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .filter(([k]) => /^id-\d+$/.test(k))
    .flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
}

/** Slugify a display name to a camelCase-ish typeId */
function slugify(name) {
  return str(name)
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Pick best sprite key from creature name */
function spriteFor(name) {
  const n = str(name);
  for (const [pattern, sprite] of SPRITE_MAP) {
    if (pattern.test(n)) return sprite;
  }
  return "bandit"; // safe default
}

/** Parse a damage notation like "1d6+2" → { die: "1d6", bonus: 2 } */
function parseDamage(notation) {
  const raw = str(notation);
  const match = raw.match(/(\d+d\d+)([+-]\d+)?/i);
  if (!match) return { die: "1d4", bonus: 0 };
  const die = match[1].toLowerCase();
  const bonus = match[2] ? parseInt(match[2], 10) : 0;
  return { die, bonus };
}

/** Ability score → modifier */
function mod(score) {
  return Math.floor((num(score) - 10) / 2);
}

// ── NPC / Monster extraction ───────────────────────────────────────────────────

/**
 * Convert a single FGU NPC node into our enemy template format.
 */
function convertNpc(npcNode) {
  const name = str(npcNode.name || npcNode.displayname);
  if (!name) return null;

  const hp = num(npcNode.hp ?? npcNode.hpmax ?? npcNode.hp_current, 10);
  const ac = num(npcNode.ac, 10);
  const crRaw = str(npcNode.cr ?? "1");
  const xpRaw = num(npcNode.xp, 0);
  const xp = xpRaw || CR_XP[crRaw] || 50;

  // Stat block
  const abilities = npcNode.abilities ?? {};
  const strMod = mod(abilities.str ?? 10);
  const dexMod = mod(abilities.dex ?? 10);
  const prof = CR_PROF[crRaw] ?? 2;

  // Actions — try standard 5e FGU paths
  const actionMap = npcNode.actions ?? npcNode.attack ?? {};
  const actionList = idEntries(actionMap);

  let damageDie = "1d6";
  let baseDmg = strMod;
  let atkBonus = strMod + prof;
  let lootTable;
  let onHit = undefined;

  if (actionList.length > 0) {
    const first = actionList[0];
    // Attack bonus: atk | bonus | toHit
    const rawAtk = first.atk ?? first.bonus ?? first.tohit;
    if (rawAtk !== undefined) atkBonus = num(rawAtk, atkBonus);

    // Damage: damage | dmg | roll
    const rawDmg = first.damage ?? first.dmg ?? first.roll ?? "";
    const parsed = parseDamage(rawDmg);
    if (parsed.die !== "1d4") {
      // only override if we found something real
      damageDie = parsed.die;
      baseDmg = parsed.bonus || Math.max(strMod, dexMod);
    }

    // Look for poison / condition rider on the action
    const actionText = plainText(
      first.description ?? first.text ?? "",
    ).toLowerCase();
    if (/poison/i.test(actionText)) {
      onHit = { status: "poison", chance: 0.3, duration: 2 };
    } else if (/stun/i.test(actionText)) {
      onHit = { status: "stun", chance: 0.25, duration: 1 };
    }
  }

  // Gold reward: 10–20% of XP as coins, CR-scaled
  const goldReward = Math.max(2, Math.round(xp * 0.08));

  // Generic loot table based on CR
  const crNum = parseFloat(crRaw) || 0;
  if (crNum <= 0.5) {
    lootTable = [
      {
        item: "Gold Coin",
        chance: 0.6,
        quantity: Math.max(1, Math.round(goldReward * 0.5)),
      },
      { item: "Small Weapon", chance: 0.2, quantity: 1 },
    ];
  } else if (crNum <= 3) {
    lootTable = [
      { item: "Gold Coin", chance: 0.8, quantity: goldReward },
      { item: "Health Potion", chance: 0.15, quantity: 1 },
      { item: "Weapon", chance: 0.2, quantity: 1 },
    ];
  } else {
    lootTable = [
      { item: "Gold Coin", chance: 0.9, quantity: goldReward },
      { item: "Health Potion", chance: 0.3, quantity: 1 },
      { item: "Rare Item", chance: 0.1, quantity: 1 },
    ];
  }

  const template = {
    name,
    sprite: spriteFor(name),
    baseHp: Math.max(1, hp),
    baseDmg: Math.max(0, baseDmg),
    damageDie,
    ac: Math.max(8, ac),
    attackBonus: Math.max(0, atkBonus),
    xpReward: xp,
    goldReward,
    lootTable,
  };

  if (onHit) template.onHit = onHit;

  // Preserve description for DM context
  const desc = plainText(npcNode.text ?? npcNode.description ?? "");
  if (desc) template.description = desc.slice(0, 300);

  return template;
}

// ── Location extraction ────────────────────────────────────────────────────────

/**
 * Guess location type from name/text keywords.
 */
function locationTypeFor(name, text) {
  const combined = `${name} ${text}`.toLowerCase();
  if (/tavern|inn|town|village|gate|market|city|safe/i.test(combined))
    return "safe_zone";
  if (/boss|final|captain|chief|leader|throne/i.test(combined))
    return "boss_room";
  return "dungeon_room";
}

/**
 * Convert a single FGU encounter / chapter / map entry to a location.
 * Returns null if not useful (no name, no text).
 */
function convertLocation(node, enemyTypeMap) {
  const name = str(node.name ?? node.title ?? "");
  if (!name) return null;

  const rawText = plainText(
    node.text ?? node.description ?? node.content ?? "",
  );
  const description =
    rawText.slice(0, 600) || `${name} — no description available.`;
  const locType = locationTypeFor(name, description);

  // Try to find what creature is referenced in this encounter
  let enemyType = undefined;
  const nameLower = name.toLowerCase() + " " + description.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;
  for (const [typeId, tmpl] of Object.entries(enemyTypeMap)) {
    const eName = tmpl.name.toLowerCase();
    if (nameLower.includes(eName)) {
      if (eName.length > bestScore) {
        bestScore = eName.length;
        bestMatch = typeId;
      }
    }
  }
  if (bestMatch) enemyType = bestMatch;

  // Build a minimal paths object — full connectivity graph isn't in db.xml,
  // so we create placeholder "return" paths the DM can expand.
  const paths = {};

  const location = {
    name,
    emoji: _emojiFor(locType),
    type: locType,
    description,
    npcs: [],
    paths,
  };

  if (enemyType) location.enemyType = enemyType;

  return location;
}

function _emojiFor(type) {
  switch (type) {
    case "safe_zone":
      return "🏰";
    case "boss_room":
      return "☠️";
    default:
      return "🌑";
  }
}

// ── Quest extraction ───────────────────────────────────────────────────────────

/**
 * Try to find quest-like entries in FGU story / notes sections.
 * FGU doesn't have a first-class quest structure, so we derive from
 * chapter names and encounters.
 */
function extractQuests(chaptersArr) {
  const quests = {};
  chaptersArr.forEach((chap, i) => {
    const title = str(chap.name ?? chap.title ?? `Quest ${i + 1}`);
    const desc = plainText(chap.text ?? chap.description ?? "").slice(0, 200);
    const id = slugify(title);
    if (!id) return;

    quests[id] = {
      id,
      title,
      giver: "Unknown",
      description: desc || `Complete the objectives in ${title}.`,
      objectives: [],
      reward: { xp: 200, gold: 50 },
      status: "inactive",
    };
  });
  return quests;
}

// ── Read-aloud extraction ──────────────────────────────────────────────────────

function extractReadAloud(chaptersArr) {
  return chaptersArr
    .map((chap) => ({
      title: str(chap.name ?? chap.title ?? "Scene"),
      text: plainText(chap.text ?? chap.description ?? "").slice(0, 800),
    }))
    .filter((r) => r.text.length > 10);
}

// ── Encounter list extraction ──────────────────────────────────────────────────

/**
 * FGU encounter_list children look like:
 *   { name: "...", creatures: { id-00001: { name: "Goblin", count: 4 } }, text: "..." }
 */
function extractEncounters(encounterMap, enemyTypeMap) {
  const locations = {};
  const entries = idEntries(encounterMap);

  entries.forEach((enc) => {
    const loc = convertLocation(enc, enemyTypeMap);
    if (loc) {
      const id = slugify(loc.name);
      if (id) locations[id] = loc;
    }
  });

  return locations;
}

// ── Chapter / reference node walking ──────────────────────────────────────────

/**
 * Recursively walk FGU reference manual chapters and flatten all entries
 * that contain meaningful text.
 */
function walkChapters(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return [];

  const results = [];

  // If this node has a name + text, it is a renderable entry
  const name = str(node.name ?? node.title ?? "");
  const text = plainText(node.text ?? node.description ?? "");
  if (name && text.length > 20) {
    results.push({ name, text });
  }

  // Recurse into id-keyed children and known sub-section keys
  const SUB_KEYS = [
    "subchapters",
    "entries",
    "sections",
    "pages",
    "content",
    "chapters",
  ];
  const recurseTargets = [
    ...idEntries(node),
    ...SUB_KEYS.flatMap((k) => (node[k] ? idEntries(node[k]) : [])),
  ];

  recurseTargets.forEach((child) => {
    results.push(...walkChapters(child, depth + 1));
  });

  return results;
}

// ── Main conversion ────────────────────────────────────────────────────────────

function convert(xmlPath) {
  console.log(`[convert] Reading XML from: ${xmlPath}`);
  const raw = readFileSync(xmlPath, "utf-8");

  console.log(`[convert] Parsing XML (${(raw.length / 1024).toFixed(0)} KB)…`);
  const doc = parser.parse(raw);
  const root = doc.root ?? doc; // FGU wraps everything in <root>

  // ── 1. Extract enemies ───────────────────────────────────────────────────
  const npcSection = root.npc ?? root.npcdata ?? root.monsters ?? {};
  const npcList = idEntries(npcSection);

  console.log(`[convert] Found ${npcList.length} NPC/monster entries.`);

  const enemies = {};
  npcList.forEach((node) => {
    const tmpl = convertNpc(node);
    if (tmpl) {
      const id = slugify(tmpl.name);
      if (id) enemies[id] = tmpl;
    }
  });

  // ── 2. Extract chapters / read-aloud ────────────────────────────────────
  const refNode = root.reference ?? root.manual ?? {};
  const manuals = refNode.manual ?? refNode;
  const chapRoot = manuals.chapters ?? manuals;

  const allChapEntries = walkChapters(chapRoot);
  console.log(`[convert] Found ${allChapEntries.length} chapter/text entries.`);

  const readAloud = extractReadAloud(allChapEntries);

  // ── 3. Extract encounter locations ──────────────────────────────────────
  const encSection =
    root.encounter_list ?? root.encounters ?? root.encounter ?? {};
  const encLocations = extractEncounters(encSection, enemies);
  console.log(
    `[convert] Extracted ${Object.keys(encLocations).length} encounter locations.`,
  );

  // ── 4. Extract story-based locations from chapters ──────────────────────
  const chapLocations = {};
  allChapEntries.forEach((entry) => {
    const id = slugify(entry.name);
    if (!id || encLocations[id]) return; // don't overwrite encounter entries
    const loc = convertLocation(entry, enemies);
    if (loc) chapLocations[id] = loc;
  });
  console.log(
    `[convert] Extracted ${Object.keys(chapLocations).length} story locations.`,
  );

  const locations = { ...encLocations, ...chapLocations };

  // ── 5. Extract quests ────────────────────────────────────────────────────
  const quests = extractQuests(allChapEntries.slice(0, 20)); // Use top-level chapters
  console.log(`[convert] Derived ${Object.keys(quests).length} quest stubs.`);

  // ── 6. Campaign meta ─────────────────────────────────────────────────────
  // FGU stores module info in root.root or root.name
  const moduleTitle = str(
    root.name ?? root.title ?? root.module?.name ?? "A Great Upheaval",
  );
  const moduleDesc = plainText(
    root.description ?? root.module?.description ?? "",
  ).slice(0, 400);
  const firstLocId = Object.keys(locations)[0] ?? null;
  const firstQuestId = Object.keys(quests)[0] ?? null;

  // ── 7. Build prompt text from chapter summaries ──────────────────────────
  const campaignSummary = allChapEntries
    .slice(0, 6)
    .map((c) => `${c.name}: ${c.text.slice(0, 120)}`)
    .join("\n");

  // ── 8. Assemble campaign.json ─────────────────────────────────────────────
  const campaign = {
    title: moduleTitle,
    version: "1.0",
    system: "D&D 5e",
    layers: [
      {
        name: "World Layer",
        type: "world",
        prompt: `You are an AI story generator running a D&D 5e campaign adaptation of "${moduleTitle}". Maintain a gritty, immersive tone. Describe environments vividly. Honour the source material's geography and tone. Players face moral choices as often as combat.`,
      },
      {
        name: "Campaign Layer",
        type: "campaign",
        prompt: `${moduleDesc || campaignSummary}\n\nKey locations: ${Object.values(
          locations,
        )
          .slice(0, 8)
          .map((l) => l.name)
          .join(", ")}.`,
      },
      {
        name: "Style Layer",
        type: "style",
        prompt:
          "Tone: dark, tense, immersive. No modern slang. Use vivid, slightly archaic descriptive language. Moral ambiguity in every interaction. Second-person present tense for narration. Keep responses under 120 words unless a dramatic scene warrants more.",
      },
      {
        name: `Page Layer — ${moduleTitle}`,
        type: "page",
        prompt: `Adapt the events and set-pieces from "${moduleTitle}". Use the listed locations and enemies. Every encounter should offer at least two resolution paths (combat and non-combat). Read-aloud text is available for key scenes.`,
        adventure: {
          id: slugify(moduleTitle),
          title: moduleTitle,
          subtitle: `Converted from FGU module`,
          description: moduleDesc || `A D&D 5e adventure: ${moduleTitle}.`,
          difficulty: "Medium",
          level: "1-4",
          duration: "4-6 hours",
          players: "3-5",
          icon: "⚔️",
          startLocation: firstLocId,
          autoStartQuests: firstQuestId ? [firstQuestId] : [],
          startDescription:
            readAloud[0]?.text ?? `Your adventure in ${moduleTitle} begins.`,
          locations,
          npcs: {},
          quests,
          readAloud,
        },
        enemies,
      },
    ],
  };

  return campaign;
}

// ── Write output ───────────────────────────────────────────────────────────────

try {
  const campaign = convert(XML_PATH);

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(campaign, null, 2), "utf-8");

  const stats = {
    enemies: Object.keys(
      campaign.layers.find((l) => l.type === "page")?.enemies ?? {},
    ).length,
    locations: Object.keys(
      campaign.layers.find((l) => l.type === "page")?.adventure?.locations ??
        {},
    ).length,
    quests: Object.keys(
      campaign.layers.find((l) => l.type === "page")?.adventure?.quests ?? {},
    ).length,
  };

  console.log("\n✅  Conversion complete!");
  console.log(`   Enemies   : ${stats.enemies}`);
  console.log(`   Locations : ${stats.locations}`);
  console.log(`   Quests    : ${stats.quests}`);
  console.log(`   Output    : ${OUT_PATH}\n`);
} catch (err) {
  console.error("\n❌  Conversion failed:", err.message);
  console.error(err.stack);
  process.exit(1);
}
