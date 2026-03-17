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

  _entries = [..._entries, entry].slice(-MAX_ENTRIES);

  eventBus.emit(EVENTS.CHRONICLE_UPDATED, {
    entry,
    entries: [..._entries],
  });

  eventBus.emit(EVENTS.NARRATIVE_UPDATE, {
    text: `📜 ${finalSummary}`,
    role: "system",
  });
}

export function initChronicleManager() {
  if (_initialized) return;
  _initialized = true;

  eventBus.on(EVENTS.FLAG_CHANGED, (payload = {}) => {
    const { flag, value } = payload;
    if (!flag || !_isImportantFlag(flag, value)) return;

    void _createEntry(payload);
  });
}

export function getChronicleEntries() {
  return [..._entries];
}
