import { eventBus, EVENTS } from "./eventBus.js";
import { geminiDMService } from "../services/GeminiDMService.js";

const MAX_ENTRIES = 80;

let _initialized = false;
let _entries = [];

function _isImportantFlag(flag, value) {
  if (value === true) return true;

  return /quest|guard|betray|stealth|combat|secret|alliance|alarm|boss|gate/i.test(
    String(flag ?? ""),
  );
}

function _buildFallbackSummary(flag, value) {
  const stateText = value ? "aktiválódott" : "megszűnt";
  return `A világ rendje megmozdult: a(z) ${flag} jelző ${stateText}.`;
}

function _publishEntry(entry) {
  _entries = [..._entries, entry].slice(-MAX_ENTRIES);

  eventBus.emit(EVENTS.CHRONICLE_UPDATED, {
    entry,
    entries: [..._entries],
  });

  eventBus.emit(EVENTS.NARRATIVE_UPDATE, {
    text: `📜 ${entry.summary}`,
    role: "system",
  });
}

async function _createEntry({ flag, value, worldState }) {
  let summary = "";

  try {
    if (geminiDMService?.summarizeFlagChange) {
      summary = await geminiDMService.summarizeFlagChange({
        flag,
        value,
        worldState,
      });
    }
  } catch (error) {
    console.warn("[ChronicleManager] Gemini summary hiba:", error);
  }

  const finalSummary = String(summary || _buildFallbackSummary(flag, value))
    .replace(/\s+/g, " ")
    .trim();

  const entry = {
    id: `chronicle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    flag,
    value,
    summary: finalSummary,
  };

  _publishEntry(entry);
}

function _createSkillCheckEntry(payload = {}) {
  const ability = String(payload.ability ?? "ability").trim();
  const dc = Number(payload.dc ?? 0);
  const total = Number(payload.total ?? 0);
  const success = payload.success === true;
  const sceneId = String(payload.sceneId ?? "").trim();

  const summary = success
    ? `Pillangó-effekt: ${ability} próba sikerült (${total}/${dc}); a sors új ösvényre terelte a történetet${sceneId ? ` (${sceneId})` : ""}.`
    : `Pillangó-effekt: ${ability} próba elbukott (${total}/${dc}); a történet komorabb fordulatot vett${sceneId ? ` (${sceneId})` : ""}.`;

  const entry = {
    id: `chronicle-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    flag: `skill_check_${ability}`,
    value: success,
    summary,
  };

  _publishEntry(entry);
}

function _createAffinityEntry(payload = {}) {
  if (!payload.significant) return;

  const npcName = String(payload.npcName ?? payload.npcId ?? "Ismeretlen NPC").trim();
  const previousValue = Number(payload.previousValue ?? 0);
  const newValue = Number(payload.newValue ?? previousValue);
  const delta = Number(payload.delta ?? newValue - previousValue);

  const summary = String(payload.chronicleText ?? "").trim() ||
    `Pillangó-effekt: ${npcName} viszonya változott (${previousValue} → ${newValue}, ${delta >= 0 ? "+" : ""}${delta}).`;

  const entry = {
    id: `chronicle-affinity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    flag: `affinity_${String(payload.npcId ?? npcName).toLowerCase()}`,
    value: newValue,
    summary,
  };

  _publishEntry(entry);
}

export function initChronicleManager() {
  if (_initialized) return;
  _initialized = true;

  eventBus.on(EVENTS.FLAG_CHANGED, (payload = {}) => {
    const { flag, value } = payload;
    if (!flag || !_isImportantFlag(flag, value)) return;

    void _createEntry(payload);
  });

  eventBus.on(EVENTS.STORY_SKILL_CHECK_RESOLVED, (payload = {}) => {
    _createSkillCheckEntry(payload);
  });

  eventBus.on(EVENTS.NPC_AFFINITY_CHANGED, (payload = {}) => {
    _createAffinityEntry(payload);
  });
}

export function getChronicleEntries() {
  return [..._entries];
}
