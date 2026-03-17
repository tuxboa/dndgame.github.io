import { eventBus, EVENTS } from "../../engine/eventBus.js";

let _initialized = false;

function _formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("hu-HU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function _renderEntry(container, entry) {
  const row = document.createElement("div");
  row.className = "chronicle-entry";

  const time = document.createElement("span");
  time.className = "chronicle-entry-time";
  time.textContent = _formatTimestamp(entry.timestamp);

  const text = document.createElement("span");
  text.className = "chronicle-entry-text";
  text.textContent = entry.summary;

  row.appendChild(time);
  row.appendChild(text);
  container.appendChild(row);
}

function _render(container, entries = []) {
  container.innerHTML = "";

  entries.forEach((entry) => {
    _renderEntry(container, entry);
  });

  container.scrollTop = container.scrollHeight;
}

export function initChronicleUI() {
  if (_initialized) return;

  const container = document.querySelector("#chronicle-log");
  if (!container) {
    console.warn("[ChronicleUI] #chronicle-log nem található.");
    return;
  }

  eventBus.on(EVENTS.CHRONICLE_UPDATED, ({ entries }) => {
    _render(container, entries);
  });

  _initialized = true;
}
