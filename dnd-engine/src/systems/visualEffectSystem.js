import { eventBus, EVENTS } from "../engine/eventBus.js";
import { logToSystemLog } from "./combatLogUI.js";

let _initialized = false;
let _diceElement = null;
let _containerElement = null;

function _wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function _onCombatStart() {
  if (!_diceElement) return;

  logToSystemLog("🎲 Kockadobás animáció elindult...");

  if (import.meta.env.DEV) {
    console.log("[VisualEffectSystem] 🎲 Kockadobás animáció elindult...");
  }

  _diceElement.classList.remove("rolling");
  void _diceElement.offsetWidth;
  _diceElement.classList.add("rolling");

  await _wait(1500);

  _diceElement.classList.remove("rolling");

  logToSystemLog("✅ Animáció befejeződött.");

  if (import.meta.env.DEV) {
    console.log("[VisualEffectSystem] ✅ Animáció befejeződött.");
  }
}

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

  _diceElement = document.querySelector("#dice-animation");
  _containerElement = document.querySelector("#game-container");

  if (!_containerElement) {
    console.warn("[VisualEffectSystem] #game-container not found.");
    return;
  }

  eventBus.subscribe(EVENTS.COMBAT_ATTACK_START, _onCombatStart, 200);
  eventBus.subscribe(EVENTS.DAMAGE_APPLIED, _onDamageApplied, -10);

  _initialized = true;
}
