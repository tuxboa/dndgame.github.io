/**
 * CampaignLoader
 * Fetches campaign.json, parses the layered prompt structure,
 * and seeds the DM slice of the store.
 *
 * Your campaign.json uses a "layers" array with types:
 *   world | campaign | page | module | style
 * Each layer has a `prompt` string the LLM sees as system context.
 */

import { gameStore } from "../store/index.js";
import { addQuest } from "../systems/questSystem.js";

/**
 * Load and parse the campaign file.
 * Call once during bootstrap — before DMController is started.
 *
 * @param {string} [path]
 * @returns {Promise<CampaignData>}
 */
export async function loadCampaign(path = "/campaigns/campaign.json") {
  let raw;

  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${path}`);
    raw = await res.json();
  } catch (err) {
    console.error("[CampaignLoader] Failed to load campaign:", err);
    throw err;
  }

  const parsed = parseCampaign(raw);

  gameStore.setState(
    {
      dm: {
        ...gameStore.getState().dm,
        campaignLayers: parsed,
      },
      campaign: {
        enemies: parsed.content.enemies,
        locations: parsed.content.locations,
        questDefs: parsed.content.questDefs,
        activeAdventure: parsed.content.activeAdventure,
      },
    },
    "campaignLoader",
  );

  console.log(`[CampaignLoader] Loaded: "${parsed.meta.title}"`);
  console.log(
    `[CampaignLoader] Enemy types loaded: ${Object.keys(parsed.content.enemies).join(", ") || "(none)"}`,
  );

  // Auto-start any quests flagged in the first adventure
  const adventure = parsed.content.activeAdventure;
  if (adventure?.autoStartQuests?.length) {
    const defs = parsed.content.questDefs;
    adventure.autoStartQuests.forEach((questId) => {
      const def = defs[questId];
      if (def) {
        addQuest({
          id: def.id,
          title: def.title,
          description: def.description ?? "",
        });
      }
    });
    console.log(
      `[CampaignLoader] Auto-started quests: ${adventure.autoStartQuests.join(", ")}`,
    );
  }

  return parsed;
}

/**
 * Parse raw JSON into a normalised CampaignData object.
 * Handles your current layers[] format.
 */
function parseCampaign(raw) {
  // Index layers by type for easy access
  const byType = {};
  if (Array.isArray(raw.layers)) {
    raw.layers.forEach((layer) => {
      // Multiple layers of the same type become an array
      if (byType[layer.type]) {
        if (!Array.isArray(byType[layer.type]))
          byType[layer.type] = [byType[layer.type]];
        byType[layer.type].push(layer);
      } else {
        byType[layer.type] = layer;
      }
    });
  }

  return {
    meta: {
      title: raw.title ?? "Unnamed Campaign",
      version: raw.version ?? "1.0",
      system: raw.system ?? "D&D 5e",
    },

    /**
     * The three prompt layers assembled into the LLM system prompt.
     * DMController combines these: world + campaign + style.
     */
    prompts: {
      world: byType.world?.prompt ?? "",
      campaign: byType.campaign?.prompt ?? "",
      style: byType.style?.prompt ?? "",

      // Page-level prompts (chapters / story arcs)
      pages: Array.isArray(byType.page)
        ? byType.page.map((p) => ({
            prompt: p.prompt,
            adventure: p.adventure,
            enemies: p.enemies,
          }))
        : byType.page
          ? [
              {
                prompt: byType.page.prompt,
                adventure: byType.page.adventure,
                enemies: byType.page.enemies,
              },
            ]
          : [],

      // Cross-module NPCs / recurring characters
      module: byType.module?.prompt ?? "",
    },

    // Static reference data (optional in your current format)
    factions: raw.factions ?? [],
    npcs: raw.npcs ?? [],
    locations: raw.locations ?? [],

    // Starting state for a new game
    start: {
      locationId: raw.startLocation ?? null,
      gold: raw.startingGold ?? 0,
      items: raw.startingItems ?? [],
      introNarration: raw.introNarration ?? "",
    },

    // ── Extracted game content (enemies, locations, quests) ───────
    content: _extractContent(byType),

    _raw: raw, // Preserve for anything not explicitly parsed
  };
}

/**
 * Walk all page layers and merge enemies, locations, quests, adventure.
 * @private
 */
function _extractContent(byType) {
  const enemies = {};
  const locations = {};
  const questDefs = {};
  let activeAdventure = null;

  // Collect enemies from the world layer first (campaign.json puts them there)
  const worldLayers = Array.isArray(byType.world)
    ? byType.world
    : byType.world
      ? [byType.world]
      : [];
  worldLayers.forEach((layer) => {
    if (layer.enemies) Object.assign(enemies, layer.enemies);
  });

  const pages = Array.isArray(byType.page)
    ? byType.page
    : byType.page
      ? [byType.page]
      : [];

  pages.forEach((layer) => {
    // Enemies live at layer.enemies (one big map, keyed by typeId)
    if (layer.enemies) {
      Object.assign(enemies, layer.enemies);
    }

    if (layer.adventure) {
      const adv = layer.adventure;

      // Locations
      if (adv.locations) Object.assign(locations, adv.locations);

      // Quests
      if (adv.quests) Object.assign(questDefs, adv.quests);

      // Store the first adventure as the active one
      if (!activeAdventure) activeAdventure = adv;
    }
  });

  return { enemies, locations, questDefs, activeAdventure };
}
