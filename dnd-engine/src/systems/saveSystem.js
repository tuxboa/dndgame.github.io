/**
 * saveSystem.js — Persist & restore game state via localStorage.
 *
 * FEATURES
 * ────────
 * • Manual save / load / delete
 * • Auto-save (debounced, 5 s after last state change)
 * • Multiple named save slots (default: 'slot_1')
 * • Save metadata: player name, level, scene, timestamp, version
 * • Forward-compat: unknown extra keys are silently dropped on load
 *
 * WHAT IS SAVED
 * ─────────────
 * Only the durable game slices — not transient UI or live DM config:
 *   player, world, combat (if active), session (identity only), trade
 *
 * NOT SAVED (intentionally)
 * ─────────────────────────
 * • dm.narrativeLog  — too large, rebuilt by the DM on next play
 * • session.isMyTurn, session.mode — runtime flags
 * • ui slice          — fully transient
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const SAVE_VERSION = 1;
const AUTOSAVE_DELAY = 5_000; // ms after last state change
const SLOT_PREFIX = "dnd_save_";
const DEFAULT_SLOT = "slot_1";
const MAX_SLOTS = 5;

// ── Internal state ────────────────────────────────────────────────────────────

let _autosaveTimer = null;
let _autosaveEnabled = false;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Manually save the current game to a named slot.
 *
 * @param {string} [slotId] - Storage key suffix, default 'slot_1'
 * @returns {{ ok: boolean, slot: string, meta: SaveMeta }}
 */
export function saveGame(slotId = DEFAULT_SLOT) {
  const state = gameStore.getState();
  const saveData = _buildSaveData(state);
  const key = SLOT_PREFIX + slotId;

  try {
    localStorage.setItem(key, JSON.stringify(saveData));
    console.log(`[SaveSystem] Saved to "${key}"`);
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: `Game saved — ${saveData.meta.playerName}, Level ${saveData.meta.level}`,
      type: "success",
      ttl: 3000,
    });
    return { ok: true, slot: slotId, meta: saveData.meta };
  } catch (err) {
    console.error("[SaveSystem] Save failed:", err);
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: "Save failed — localStorage may be full.",
      type: "error",
      ttl: 4000,
    });
    return { ok: false, slot: slotId, meta: null };
  }
}

/**
 * Load a saved game, patching the store directly.
 *
 * @param {string} [slotId]
 * @returns {{ ok: boolean, meta: SaveMeta | null }}
 */
export function loadGame(slotId = DEFAULT_SLOT) {
  const key = SLOT_PREFIX + slotId;
  const raw = localStorage.getItem(key);

  if (!raw) {
    console.warn(`[SaveSystem] No save found at "${key}"`);
    return { ok: false, meta: null };
  }

  let saveData;
  try {
    saveData = JSON.parse(raw);
  } catch (err) {
    console.error("[SaveSystem] Corrupt save data:", err);
    return { ok: false, meta: null };
  }

  if (saveData.version !== SAVE_VERSION) {
    console.warn(
      `[SaveSystem] Version mismatch (expected ${SAVE_VERSION}, got ${saveData.version}). Attempting to load anyway.`,
    );
  }

  try {
    _applySaveData(saveData);
    console.log(`[SaveSystem] Loaded from "${key}"`);
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: `Loaded — ${saveData.meta.playerName}, Level ${saveData.meta.level}`,
      type: "success",
      ttl: 3000,
    });
    return { ok: true, meta: saveData.meta };
  } catch (err) {
    console.error("[SaveSystem] Load failed:", err);
    return { ok: false, meta: null };
  }
}

/**
 * Returns whether a save exists in the given slot.
 * @param {string} [slotId]
 * @returns {boolean}
 */
export function hasSavedGame(slotId = DEFAULT_SLOT) {
  return localStorage.getItem(SLOT_PREFIX + slotId) !== null;
}

/**
 * Delete a save slot.
 * @param {string} [slotId]
 */
export function deleteSave(slotId = DEFAULT_SLOT) {
  localStorage.removeItem(SLOT_PREFIX + slotId);
  console.log(`[SaveSystem] Deleted save "${slotId}"`);
}

/**
 * List all save slots with their metadata.
 * @returns {Array<{ slotId: string, meta: SaveMeta }>}
 */
export function listSaves() {
  const results = [];
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const slotId = `slot_${i}`;
    const raw = localStorage.getItem(SLOT_PREFIX + slotId);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw);
      results.push({ slotId, meta: data.meta });
    } catch {
      results.push({ slotId, meta: null });
    }
  }
  return results;
}

/**
 * Enable automatic saving after state changes.
 * Each state change resets a debounce timer; the save fires after quiet period.
 *
 * @param {string} [slotId]
 */
export function enableAutosave(slotId = DEFAULT_SLOT) {
  if (_autosaveEnabled) return;
  _autosaveEnabled = true;

  gameStore.subscribe(() => {
    if (!_autosaveEnabled) return;
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(() => {
      const state = gameStore.getState();
      // Only auto-save if there's actually a character
      if (state.player.name) saveGame(slotId);
    }, AUTOSAVE_DELAY);
  });

  console.log(
    `[SaveSystem] Autosave enabled (slot: ${slotId}, delay: ${AUTOSAVE_DELAY}ms)`,
  );
}

/** Disable autosave and cancel any pending timer. */
export function disableAutosave() {
  _autosaveEnabled = false;
  clearTimeout(_autosaveTimer);
}

/**
 * Export state as a downloadable JSON file.
 * Useful for sharing characters or backing up before experimenting.
 */
export function exportSave() {
  const state = gameStore.getState();
  const saveData = _buildSaveData(state);
  const json = JSON.stringify(saveData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `dnd_save_${saveData.meta.playerName.replace(/\s+/g, "_")}_${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Import a previously exported save file.
 * Prompts the user with a file picker.
 *
 * @returns {Promise<{ ok: boolean, meta: SaveMeta | null }>}
 */
export function importSave() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return resolve({ ok: false, meta: null });

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const saveData = JSON.parse(e.target.result);
          _applySaveData(saveData);
          resolve({ ok: true, meta: saveData.meta });
        } catch (err) {
          console.error("[SaveSystem] Import failed:", err);
          resolve({ ok: false, meta: null });
        }
      };
      reader.readAsText(file);
    });

    input.click();
  });
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * @typedef {{ playerName: string, level: number, scene: string, savedAt: number, version: number }} SaveMeta
 */

function _buildSaveData(state) {
  return {
    version: SAVE_VERSION,
    meta: {
      playerName: state.player.name || "Unknown",
      level: state.player.level,
      class: state.player.class,
      race: state.player.race,
      scene: state.world.currentSceneId ?? "unknown",
      savedAt: Date.now(),
    },
    player: state.player,
    world: {
      currentSceneId: state.world.currentSceneId,
      sceneDescription: state.world.sceneDescription,
      discoveredLocations: state.world.discoveredLocations,
      npcsPresent: state.world.npcsPresent,
      // Persist quest state and story flags so they survive reload
      quests: state.world.quests ?? [],
      storyFlags: state.world.storyFlags ?? {},
      npcRelationships: state.world.npcRelationships ?? {},
    },
    // Persist user settings (language preference etc.)
    settings: state.settings ?? {},
    // Persist DM memory so the AI continues from where it left off
    storySoFar: state.dm.storySoFar ?? "",
    narrativeLogTail: state.dm.narrativeLog.slice(-10),
    turnCount: state.dm.turnCount ?? 0,
    combat: state.combat.active ? state.combat : null,
    trade: state.trade,
    // session identity only — runtime flags omitted
    session: {
      id: state.session.id,
      localPlayerId: state.session.localPlayerId,
    },
  };
}

function _applySaveData(saveData) {
  const current = gameStore.getState();

  const patch = { player: saveData.player };

  if (saveData.world) {
    patch.world = {
      ...current.world,
      currentSceneId: saveData.world.currentSceneId,
      sceneDescription: saveData.world.sceneDescription,
      discoveredLocations: saveData.world.discoveredLocations ?? [],
      npcsPresent: saveData.world.npcsPresent ?? [],
      quests: saveData.world.quests ?? [],
      storyFlags: saveData.world.storyFlags ?? {},
      npcRelationships: saveData.world.npcRelationships ?? {},
    };
  }

  // Restore DM memory so the AI remembers the campaign
  if (saveData.storySoFar != null || saveData.narrativeLogTail) {
    patch.dm = {
      ...current.dm,
      storySoFar: saveData.storySoFar ?? current.dm.storySoFar ?? "",
      narrativeLog: saveData.narrativeLogTail ?? current.dm.narrativeLog ?? [],
      turnCount: saveData.turnCount ?? current.dm.turnCount ?? 0,
    };
  }

  // Restore user settings (language etc.)
  if (saveData.settings) {
    patch.settings = { ...(current.settings ?? {}), ...saveData.settings };
    // Sync language to localStorage for offline reads
    if (saveData.settings.language) {
      try {
        localStorage.setItem("dnd_lang", saveData.settings.language);
      } catch {
        /* noop — private browsing or storage quota */
      }
    }
  }

  if (saveData.combat) {
    patch.combat = saveData.combat;
  }

  if (saveData.trade) {
    patch.trade = saveData.trade;
  }

  if (saveData.session) {
    patch.session = {
      ...current.session,
      id: saveData.session.id,
      localPlayerId: saveData.session.localPlayerId,
    };
  }

  gameStore.setState(patch, "saveSystem:load");
}
