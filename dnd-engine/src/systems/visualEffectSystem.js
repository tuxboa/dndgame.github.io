import { eventBus, EVENTS } from "../engine/eventBus.js";
import { logToSystemLog } from "./combatLogUI.js";

let _initialized = false;
let _containerElement = null;

function _onDamageApplied(payload) {
  if (!_containerElement) return;
  if (!payload?.isCritical) return;

  logToSystemLog("💥 KRITIKUS TALÁLAT! Screen shake aktiválva.");

  if (import.meta.env.DEV) {
    console.log(
      "[VisualEffectSystem] 💥 KRITIKUS TALÁLAT! Screen shake aktiválva.",
    );
  }

  _containerElement.classList.remove("shake");
  void _containerElement.offsetWidth;
  _containerElement.classList.add("shake");

  window.setTimeout(() => {
    _containerElement?.classList.remove("shake");
  }, 400);
}

export function initVisualEffectSystem() {
  if (_initialized) return;

  _containerElement = document.querySelector("#game-container");

  if (!_containerElement) {
    console.warn("[VisualEffectSystem] #game-container not found.");
    return;
  }

  eventBus.subscribe(EVENTS.DAMAGE_APPLIED, _onDamageApplied, -10);

  _initialized = true;
}
