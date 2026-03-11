/**
 * DMController — The LLM Dungeon Master
 *
 * Responsibilities:
 *   - Assemble a context object from the current game state + campaign layers
 *   - Send it to the OpenAI API (or run an offline fallback)
 *   - Parse the structured JSON response
 *   - Dispatch the DM's decisions as game events
 *
 * The LLM is instructed to always respond with a JSON object:
 * {
 *   "narration":   "...",          // Text shown to the player
 *   "worldState":  { ... },        // State patches the DM wants to apply
 *   "actions":     ["...", "..."], // Available player actions
 *   "combatTrigger": null | { enemies: [...] }
 * }
 *
 * The DM never directly mutates state — it emits events which go through
 * actionDispatcher, preserving the unidirectional data flow.
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { getGroqKey, saveGroqKey } from "../config/apiConfig.js";
import {
  addQuest,
  completeQuest,
  failQuest,
  getActiveQuests,
} from "./questSystem.js";

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

// ─────────────────────────────────────────────────────────────────────────────
// API KEY — for local testing paste your key here OR use the in-game ⚙️ modal.
// NEVER commit a real key to source control.
//
// The in-game settings modal (⚙️) calls setApiKey() which stores the key in
// sessionStorage so it survives page refreshes within the same tab.
// ─────────────────────────────────────────────────────────────────────────────

// API key loaded from localStorage via apiConfig; set in-game via the ⚙️ Settings modal.
let _apiKey = getGroqKey();
let _listenersWired = false;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the DM controller.
 * Call once during bootstrap after campaign is loaded.
 * Safe to call again with a new key (e.g. from the settings modal) —
 * listeners are registered only on the first call.
 *
 * @param {string} apiKey
 */
export function initDM(apiKey) {
  // Only overwrite the key when a real value is supplied.
  // This preserves _DEV_KEY when bootstrap calls initDM(null).
  if (apiKey) _apiKey = apiKey;

  if (!_listenersWired) {
    _listenersWired = true;

    // Free-text actions submitted by ActionInputUI
    eventBus.on(EVENTS.PLAYER_CUSTOM_ACTION, ({ text }) => {
      processTurn(text).catch((err) =>
        console.error("[DMController] PLAYER_CUSTOM_ACTION failed:", err),
      );
    });
  }

  console.log(`[DMController] Initialised — model: ${GROQ_MODEL}.`);
}

/**
 * Ask the DM to process a player action and generate the next scene.
 * This is the main entry point — call after any meaningful player input.
 *
 * @param {string} playerAction - Plain English description of what the player does
 * @returns {Promise<DMResponse>}
 */
export async function processTurn(playerAction) {
  const state = gameStore.getState();

  // Log the player action immediately
  _appendToNarrativeLog("player", playerAction);

  // Re-read DM slice AFTER the log append so we don't overwrite the new entry.
  const freshDmState = gameStore.getState().dm;

  // Mark LLM as pending so UI can show a loading state
  gameStore.setState(
    { dm: { ...freshDmState, pendingResponse: true } },
    "dmController",
  );

  const context = buildContext(state, playerAction);
  eventBus.emit(EVENTS.DM_CONTEXT_READY, { context });

  let response;

  try {
    response = _apiKey
      ? await _callGroq(context)
      : _offlineFallback(playerAction);
  } catch (err) {
    console.error("[DMController] LLM call failed:", err);
    const errMsg = `⚠️ AI Error: ${err.message}\n\n[Falling back to offline mode] You: "${playerAction}"`;
    response = {
      ..._offlineFallback(playerAction),
      narration_hu: errMsg,
      narration_en: errMsg,
      narration: errMsg,
    };
  }

  try {
    _applyDMResponse(response, context);
  } catch (applyErr) {
    console.error("[DMController] _applyDMResponse crashed:", applyErr);
    // Ensure the UI never gets permanently stuck in the "pending" loading state
    const dmNow = gameStore.getState().dm;
    gameStore.setState(
      { dm: { ...dmNow, pendingResponse: false } },
      "dmController:errorClear",
    );
  }

  // Increment turn counter and fire background summarization every 8 turns
  const newTurnCount = (gameStore.getState().dm.turnCount ?? 0) + 1;
  gameStore.setState(
    { dm: { ...gameStore.getState().dm, turnCount: newTurnCount } },
    "dmController:turnCount",
  );
  if (newTurnCount % 8 === 0 && _apiKey) {
    _summarizeInBackground().catch((err) =>
      console.warn("[DMController] Background summarization failed:", err),
    );
  }

  return response;
}

/**
 * Set or update the API key at runtime.
 * Use this from UI settings — never hardcode.
 */
export function setApiKey(key) {
  const trimmed = (key ?? "").trim();
  _apiKey = trimmed;
  saveGroqKey(trimmed);
}

/**
 * Restore key from localStorage (persistent across sessions).
 * Returns "" when no key has been saved yet (offline mode).
 */
export function restoreApiKey() {
  return getGroqKey();
}

// ── Context Builder ───────────────────────────────────────────────────────────

/**
 * Assemble the context object the LLM receives each turn.
 * Pulls from the layered campaign prompts + live game state.
 * Deliberately lean — the LLM doesn't need every field.
 *
 * @param {GameState} state
 * @param {string} playerAction
 * @returns {LLMContext}
 */
export function buildContext(state, playerAction) {
  const layers = state.dm.campaignLayers?.prompts ?? {};
  const storySoFar = state.dm.storySoFar ?? "";

  // ── Token budget guards — Groq limit: ~12 000 tokens ──────────────────────
  // storySoFar: max 5 000 chars (~1 250 tokens)
  // Each campaign layer: max 1 000 chars (~250 tokens)
  const storySoFarLimited = storySoFar.slice(0, 5000);
  const layersLimited = {
    world: (layers.world ?? "").slice(0, 1000),
    campaign: (layers.campaign ?? "").slice(0, 1000),
    style: (layers.style ?? "").slice(0, 1000),
  };

  // Build a list of known enemy types so the DM can reference them correctly
  const enemyTypes = Object.keys(state.campaign?.enemies ?? {});
  const enemyTypesHint = enemyTypes.length
    ? `AVAILABLE ENEMY TYPES (use these exact keys in combatTrigger): ${enemyTypes.join(", ")}`
    : "";

  return {
    systemPrompt: [
      // ── Szerepkör ──────────────────────────────────────────────────────────
      "Te egy legendás, ősi Dungeon Master vagy, aki sötét fantasy D&D 5e kampányt vezet.",
      "Légy atmoszférikus, sötét és drámai. Fogadj el játékos inputot magyarul és angolul egyaránt.",
      // ── Kétnyelvű narráció szabályai ───────────────────────────────────────
      "NARRÁCIÓ SZABÁLYAI:",
      "  • narration_hu: KIZÁRÓLAG magyar nyelvű, sötét, légköri szöveg. Tegezd a játékost. Ez jelenik meg a képernyőn.",
      "  • narration_en: KIZÁRÓLAG angol nyelvű, választékos brit stílus, bölcs varázsló narrátornak. Ez szólal meg hangként.",
      "  • D&D játékmechanikai kifejezések (Saving Throw, Armor Class, Hit Points, stb.) mindkét mezőben ANGOLUL maradjanak.",
      // ── Játékos azonosítás ─────────────────────────────────────────────────
      state.player.name
        ? `A játékos karaktere: ${state.player.name}, egy ${state.player.level ?? 1}. szintű ${
            state.player.race ? state.player.race + " " : ""
          }${state.player.class ?? "kalandor"}. Szólítsd nevén mindkét mezőben.`
        : "",
      // ── Kötelező JSON séma — SEMMI egyéb szöveg a válaszban ───────────────
      "VÁLASZFORMÁTUM: Kizárólag egyetlen valid JSON objektumot küldj vissza, markdown kódblokk nélkül.",
      "A mezők leírása:",
      "  narration_hu  : string  — magyar szöveg a képernyőre",
      "  narration_en  : string  — angol szöveg a hangfelolvasónak",
      "  worldState   : object  — állapot-patch (lehet {})",
      "  actions      : string[] — 3-4 következő lehetséges játékos akció",
      "  combatTrigger: Ha ellenségek jelennek meg, KÖTELEZŐ: { enemies: [{ type: string, count: number }] } — Ha nincs harc: null",
      "  quests       : null VAGY [{ action: 'add'|'complete'|'fail', id: string, title?: string, type?: 'main'|'side', description?: string }]",
      "",
      // !! KRIT Harc: combatTrigger
      "!!!KRITIKUS!!! Ha a narrációban ellenségek jelennek meg vagy harc indul, a combatTrigger SOSEM lehet null!",
      `Harc combatTrigger példa — pontosan ilyen formátumban: ${JSON.stringify({ enemies: [{ type: enemyTypes[0] ?? "goblin", count: 1 }] })}`,
      `Ismerd a rendelkezésre álló ellenségtípusokat és használd ezeket: ${enemyTypes.join(", ") || "goblin"}`,
      enemyTypesHint,
      // ── NPC memória szabályai ─────────────────────────────────────────────
      "NPC KEZELÉS:",
      "  • Ha egy NPC-vel interakcióba lép a játékos, küldj egy opcionális 'npcUpdates' mezőt:",
      "    npcUpdates: [{ id: string, name: string, disposition: 'friendly'|'neutral'|'hostile', note: string }]",
      "  • Használd a kontextusban megadott npcRelationships értékeket a korábbi viszony fenntartásához.",
      "  • Ha nincs NPC interakció, hagyd el a mezőt vagy adj vissza null-t.",
      // ── Kampány kontextus ──────────────────────────────────────────────────
      layersLimited.world ? `--- WORLD ---\n${layersLimited.world}` : "",
      layersLimited.campaign
        ? `--- CAMPAIGN ---\n${layersLimited.campaign}`
        : "",
      layersLimited.style ? `--- STYLE ---\n${layersLimited.style}` : "",
      storySoFarLimited ? `--- STORY SO FAR ---\n${storySoFarLimited}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),

    // Recent narrative context (last 8 exchanges — older ones live in storySoFar)
    recentLog: state.dm.narrativeLog.slice(-8),

    // Current player state (lean snapshot)
    player: {
      name: state.player.name,
      class: state.player.class,
      race: state.player.race,
      level: state.player.level,
      hp: state.player.hp,
      maxHp: state.player.maxHp,
      mana: state.player.mana ?? 0,
      maxMana: state.player.maxMana ?? 0,
      knownSpells: (state.player.knownSpells ?? []).join(", ") || "none",
      equipped:
        Object.entries(state.player.equipment ?? {})
          .filter(([, v]) => v)
          .map(([slot, item]) => `${slot}: ${item?.itemId ?? item}`)
          .join(", ") || "nothing",
      conditions: state.player.conditions,
      goldPieces: state.player.gold,
      inventory: state.player.inventory.map((i) => `${i.name} x${i.quantity}`),
    },

    // Scene state
    scene: {
      description: state.world.sceneDescription,
      npcsPresent: state.world.npcsPresent,
      enemiesPresent: state.world.enemiesPresent,
    },

    // Active quests (so DM knows what's already tracked)
    activeQuests: getActiveQuests().map((q) => ({ id: q.id, title: q.title })),

    // NPC relationship memory — DM keeps these consistent
    npcRelationships: state.world.npcRelationships ?? {},

    playerAction,
  };
}

// ── Private ───────────────────────────────────────────────────────────────────

/**
 * Build an OpenAI-compatible messages array for Groq.
 * Format: system prompt first, then alternating user/assistant history,
 * then the current player action as the final user message.
 *
 * @param {string} systemPrompt
 * @param {Array}  recentLog
 * @param {Object} currentPayload  — serialised as the final user message
 * @returns {Array}
 */
function _buildGroqMessages(systemPrompt, recentLog, currentPayload) {
  const messages = [{ role: "system", content: systemPrompt }];

  // Map roles and strip anything that isn't player / dm
  const history = recentLog
    .filter((e) => e.role === "player" || e.role === "dm")
    .map((e) => ({
      role: e.role === "player" ? "user" : "assistant",
      content: e.text,
    }));

  // Merge consecutive same-role entries
  const merged = history.reduce((acc, msg) => {
    const last = acc.at(-1);
    if (last && last.role === msg.role) {
      last.content += "\n" + msg.content;
    } else {
      acc.push({ role: msg.role, content: msg.content });
    }
    return acc;
  }, []);

  // Append the current player action as the final user message
  merged.push({ role: "user", content: JSON.stringify(currentPayload) });

  return [...messages, ...merged];
}

async function _callGroq(context, _retryCount = 0) {
  const messages = _buildGroqMessages(context.systemPrompt, context.recentLog, {
    playerAction: context.playerAction,
    player: context.player,
    scene: context.scene,
  });

  const body = {
    model: GROQ_MODEL,
    messages,
    response_format: { type: "json_object" },
    max_tokens: 1024,
    temperature: 0.8,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let res;
  try {
    res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${_apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text();

    // On 429, read Retry-After header and wait once before giving up.
    if (res.status === 429 && _retryCount < 1) {
      const retryAfter =
        res.headers.get("retry-after") ??
        res.headers.get("x-ratelimit-reset-requests");
      const retryDelaySec = retryAfter
        ? Math.ceil(parseFloat(retryAfter)) + 2
        : 30;

      console.warn(
        `[DMController] Rate limited. Retrying in ${retryDelaySec}s…`,
      );
      _appendToNarrativeLog(
        "dm",
        `⏳ *Rate limited — retrying in ${retryDelaySec} seconds…*`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelaySec * 1000));
      return _callGroq(context, _retryCount + 1);
    }

    throw new Error(`Groq error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content;
  if (!rawText) throw new Error("Empty response from Groq.");

  // ── Hardened JSON parse — strip markdown fences if the model adds them ──
  let cleaned = rawText.trim();
  // Remove ```json ... ``` or ``` ... ``` wrappers
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  // Find the outermost { ... } in case there's stray text before/after
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error("[DMController] JSON parse failed. Raw response:", rawText);
    throw new Error(`JSON parse error: ${parseErr.message}`, {
      cause: parseErr,
    });
  }

  // Validate required bilingual fields
  if (!parsed.narration_hu && !parsed.narration_en && !parsed.narration) {
    console.warn("[DMController] Response missing narration fields:", parsed);
  }

  return parsed;
}

/**
 * Offline fallback — used when no API key is set.
 * Returns a minimal valid response so the game still works.
 */
function _offlineFallback(playerAction) {
  const hu = `[Offline mód] Cselekedtél: "${playerAction}". A világ visszafojtja lélegzetét.`;
  const en = `[Offline mode] You decided to: "${playerAction}". The world holds its breath.`;
  return {
    narration_hu: hu,
    narration_en: en,
    narration: hu, // backwards-compat field
    worldState: {},
    actions: ["Look around", "Continue forward", "Rest", "Check inventory"],
    combatTrigger: null,
  };
}

/**
 * Apply the DM's structured response to the store and emit events.
 */
function _applyDMResponse(response, context) {
  // ── DEBUG: log full response so combatTrigger issues are visible in DevTools ──
  console.log(
    "[DMController] Full DM response:",
    JSON.stringify(response, null, 2),
  );

  // ── Normalise dual-field / legacy single-field schema ──────────────────────
  if (!response.narration_hu && response.narration) {
    // Legacy single-field: promote to both slots
    response.narration_hu = response.narration;
    response.narration_en = response.narration;
  }

  // Pick narration text based on language setting (hu default, en if user selected English)
  const lang = gameStore.getState().settings?.language ?? "hu";
  const displayText =
    lang === "en"
      ? (response.narration_en ?? response.narration ?? "")
      : (response.narration_hu ?? response.narration ?? "");
  // English text → Google TTS (picked up by ttsSystem via DM_RESPONSE_RECEIVED)
  // narration_en stays on the response object; ttsSystem reads it from the event.

  if (!displayText) {
    console.warn(
      "[DMController] _applyDMResponse: no narration_hu in response",
      response,
    );
  }

  // 1. Append Hungarian narration to log (shown on screen)
  _appendToNarrativeLog("dm", displayText);

  // Re-read state after the log append to avoid overwriting the new entry.
  const freshState = gameStore.getState();

  // 2. Update available actions + clear pending flag + store the context used
  gameStore.setState(
    {
      dm: {
        ...freshState.dm,
        pendingResponse: false,
        lastContext: context ?? freshState.dm.lastContext,
      },
      world: { ...freshState.world, availableActions: response.actions ?? [] },
    },
    "dmController:applyResponse",
  );

  // 3. Apply any world state patches the DM requested
  if (response.worldState && Object.keys(response.worldState).length > 0) {
    const currentWorld = gameStore.getState().world;
    gameStore.setState(
      {
        world: { ...currentWorld, ...response.worldState },
      },
      "dmController:worldStatePatch",
    );
  }

  // 4. Trigger combat if DM decided to start an encounter
  if (response.combatTrigger) {
    // Emit COMBAT_REQUESTED — actionDispatcher resolves templates & calls startCombat()
    eventBus.emit(EVENTS.COMBAT_REQUESTED, response.combatTrigger);
  }

  // 5. Handle quest updates
  if (Array.isArray(response.quests)) {
    for (const q of response.quests) {
      if (q.action === "add")
        addQuest({
          id: q.id,
          title: q.title ?? q.id,
          description: q.description ?? "",
          type: q.type ?? "side",
          parentId: q.parentId ?? null,
        });
      else if (q.action === "complete") completeQuest(q.id);
      else if (q.action === "fail") failQuest(q.id);
    }
  }

  // 6. Handle NPC relationship updates
  if (Array.isArray(response.npcUpdates) && response.npcUpdates.length > 0) {
    const currentWorld = gameStore.getState().world;
    const rels = { ...(currentWorld.npcRelationships ?? {}) };
    for (const upd of response.npcUpdates) {
      if (!upd.id) continue;
      const prev = rels[upd.id] ?? {
        name: upd.name ?? upd.id,
        disposition: "neutral",
        notes: [],
      };
      const notes = [...prev.notes];
      if (upd.note) notes.push(upd.note);
      // Cap notes at 6 to avoid prompt bloat
      if (notes.length > 6) notes.splice(0, notes.length - 6);
      rels[upd.id] = {
        name: upd.name ?? prev.name,
        disposition: upd.disposition ?? prev.disposition,
        notes,
      };
      eventBus.emit(EVENTS.NPC_UPDATED, rels[upd.id]);
    }
    gameStore.setState(
      { world: { ...currentWorld, npcRelationships: rels } },
      "dmController:npcUpdate",
    );
  }

  eventBus.emit(EVENTS.DM_RESPONSE_RECEIVED, response);
  // TTS is handled by ttsSystem's DM_RESPONSE_RECEIVED listener — no call needed here.
}

function _appendToNarrativeLog(role, text) {
  const dm = gameStore.getState().dm;
  gameStore.setState(
    {
      dm: {
        ...dm,
        narrativeLog: [
          ...dm.narrativeLog,
          { role, text, timestamp: Date.now() },
        ],
      },
    },
    "dmController:appendLog",
  );
}

/**
 * Background task: compress old narrative entries into storySoFar.
 * Keeps the context window lean while preserving long-term memory.
 * Runs every 8 turns (when API key is set).
 *
 * Strategy:
 *  - Take all entries except the most recent 6 (keep those in full)
 *  - Ask the LLM to compress them into ≤3 sentences
 *  - Prepend any existing storySoFar to preserve older memory
 *  - Trim the log to just the most recent 6 entries
 */
async function _summarizeInBackground() {
  const dm = gameStore.getState().dm;
  const log = dm.narrativeLog;

  if (log.length <= 8) return; // Not enough history to compress

  const toCompress = log.slice(0, -6); // All but last 6
  const keepRecent = log.slice(-6); // Keep last 6 in full

  const previousSummary = dm.storySoFar
    ? `Previous summary: ${dm.storySoFar}\n\n`
    : "";

  const eventText = toCompress.map((e) => `[${e.role}]: ${e.text}`).join("\n");

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${_apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            (gameStore.getState().settings?.language ?? "hu") === "en"
              ? "Summarize the following D&D session events in 2-3 concise sentences in English. Focus on: what the player did, key narrative turning points, combat outcomes, quest progress. Past tense, third person."
              : "Foglald össze a következő D&D session eseményeit 2-3 tömör mondatban magyarul. Fókuszálj arra: mit tett a játékos, kulcsfontosságú történeti fordulatok, harc kimenetele, küldetség előrehaladása. Múlt idő, harmadik személy.",
        },
        {
          role: "user",
          content: `${previousSummary}Events to summarize:\n${eventText}`,
        },
      ],
      max_tokens: 256,
      temperature: 0.3,
    }),
  });

  if (!res.ok) return;

  const data = await res.json();
  const newSummary = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!newSummary) return;

  // Commit: update storySoFar and trim the log
  const freshDm = gameStore.getState().dm;
  gameStore.setState(
    {
      dm: {
        ...freshDm,
        storySoFar: newSummary,
        narrativeLog: keepRecent,
      },
    },
    "dmController:summarize",
  );

  console.log(
    "[DMController] Memory compressed:",
    newSummary.slice(0, 80) + "…",
  );
}

/**
 * @typedef {Object} DMResponse
 * @property {string}   narration
 * @property {Object}   worldState
 * @property {string[]} actions
 * @property {null | { enemies: any[] }} combatTrigger
 */

/**
 * @typedef {Object} LLMContext
 * @property {string}  systemPrompt
 * @property {Array}   recentLog
 * @property {Object}  player
 * @property {Object}  scene
 * @property {string}  playerAction
 */
