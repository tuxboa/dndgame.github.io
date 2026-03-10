/**
 * questSystem.js — Quest tracking.
 *
 * Quests are written to world.quests[] in the store.
 * The DM controller calls these when the LLM response includes quest actions.
 *
 * Quest shape:
 *   { id, title, description, type: 'main'|'side', parentId?, status: 'active'|'completed'|'failed', addedAt }
 *
 * type     — 'main' = fő quest (arany, mindig felül), 'side' = mellékküldetés (default)
 * parentId — ha meg van adva, a side quest a megadott main quest alatt jelenik meg
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Add a new quest. Silently skips if a quest with the same id already exists.
 *
 * @param {{ id: string, title: string, description?: string, type?: 'main'|'side', parentId?: string }} quest
 */
export function addQuest({
  id,
  title,
  description = "",
  type = "side",
  parentId = null,
}) {
  const state = gameStore.getState();
  const quests = state.world.quests ?? [];

  if (quests.some((q) => q.id === id)) return;

  const entry = {
    id,
    title,
    description,
    type,
    parentId,
    status: "active",
    addedAt: Date.now(),
  };
  gameStore.setState(
    { world: { ...state.world, quests: [...quests, entry] } },
    "questSystem:add",
  );

  eventBus.emit(EVENTS.QUEST_ADDED, entry);
  eventBus.emit(EVENTS.UI_NOTIFICATION, {
    text: `New quest: ${title}`,
    type: "info",
    ttl: 4500,
  });
}

/**
 * Mark a quest as completed.
 * @param {string} id
 */
export function completeQuest(id) {
  _setStatus(id, "completed");
  const q = _find(id);
  if (q) {
    eventBus.emit(EVENTS.QUEST_COMPLETED, q);
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: `Quest complete: ${q.title}`,
      type: "success",
      ttl: 4500,
    });
  }
}

/**
 * Mark a quest as failed.
 * @param {string} id
 */
export function failQuest(id) {
  _setStatus(id, "failed");
  const q = _find(id);
  if (q) eventBus.emit(EVENTS.QUEST_FAILED, q);
}

/** Returns all quests with status 'active'. */
export function getActiveQuests() {
  return (gameStore.getState().world.quests ?? []).filter(
    (q) => q.status === "active",
  );
}

/** Returns all quests. */
export function getAllQuests() {
  return gameStore.getState().world.quests ?? [];
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _setStatus(id, status) {
  const state = gameStore.getState();
  const quests = (state.world.quests ?? []).map((q) =>
    q.id === id ? { ...q, status } : q,
  );
  gameStore.setState(
    { world: { ...state.world, quests } },
    `questSystem:${status}`,
  );
}

function _find(id) {
  return (gameStore.getState().world.quests ?? []).find((q) => q.id === id);
}
