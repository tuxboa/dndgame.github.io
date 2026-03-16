import { eventBus, EVENTS } from "../engine/eventBus.js";
import { gameStore } from "../store/index.js";

let _initialized = false;
let _combatLogElement = null;
let _systemLogElement = null;

const _messageTemplates = {
  critical: [
    "💥 Brutális kritikus csapás! {target} {amount} sebzést szenved el!",
    "🎯 Pont a gyenge ponton! {target} {amount} életerőt veszít!",
    "🔥 Egy megsemmisítő találat! {amount} sebzés {target} számára!",
  ],
  normal: [
    "⚔️ A támadás célba ér. {target} {amount} sebzést kap.",
    "🛡️ {target} próbál védekezni, de {amount} sebzés így is átjut.",
    "A fegyver zaja visszhangzik a csatában. {amount} sebzés {target} ellen.",
  ],
  zero: [
    "🛡️ A támadás lepattan {target} páncéljáról! Nincs sebzés.",
    "💨 {target} ügyesen kitér a csapás elől!",
    "A támadás hatástalan {target} védelmével szemben.",
  ],
};

function _appendMessage(el, message, typeClass = "") {
  if (!el) return;

  const messageEl = document.createElement("div");
  messageEl.className = typeClass ? `log-message ${typeClass}` : "log-message";
  messageEl.textContent = message;

  el.appendChild(messageEl);
  el.scrollTop = el.scrollHeight;
}

function _pickRandom(messages) {
  return messages[Math.floor(Math.random() * messages.length)];
}

function _resolveTargetName(targetId) {
  if (!targetId) return "ismeretlen célpont";

  const state = gameStore.getState();
  const combatant = state.combat.turnOrder.find((p) => p.id === targetId);
  if (combatant?.name) return combatant.name;

  const playerId = state.player?.id ?? "player";
  if (targetId === playerId) return state.player?.name ?? "Játékos";

  return targetId;
}

function _onCombatStart(payload) {
  const targetName = _resolveTargetName(payload?.targetId);
  logToSystemLog(`🎲 Támadás indult: ${targetName}`);
}

function _onDamageApplied(payload) {
  if (!_combatLogElement || !payload) return;

  const targetName = _resolveTargetName(payload.targetId);
  const amount = Math.max(0, Math.floor(payload.amount ?? 0));
  const isCritical = payload.isCritical === true;

  let template;
  let typeClass;

  if (isCritical) {
    template = _pickRandom(_messageTemplates.critical);
    typeClass = "critical-hit";
  } else if (amount <= 0) {
    template = _pickRandom(_messageTemplates.zero);
    typeClass = "zero-damage";
  } else {
    template = _pickRandom(_messageTemplates.normal);
    typeClass = "normal-hit";
  }

  const message = template
    .replace("{target}", targetName)
    .replace("{amount}", amount.toString());

  _appendMessage(_combatLogElement, message, typeClass);
  logToSystemLog("✅ DAMAGE_APPLIED lánc lefutott.");
}

function _onNarrationReceived(payload) {
  if (!_combatLogElement || !payload) return;

  const text = String(payload.text ?? "").trim();
  if (!text) return;

  const messageEl = document.createElement("div");
  messageEl.className = "log-message dm-narration";
  messageEl.textContent = text;

  const color = payload.color ?? "gold";
  messageEl.style.color = color;

  if (color === "gold" || color === "#FFD700") {
    messageEl.style.fontStyle = "italic";
    messageEl.style.textShadow = "1px 1px 2px #000";
  }

  _combatLogElement.appendChild(messageEl);
  _combatLogElement.scrollTop = _combatLogElement.scrollHeight;
}

export function logToSystemLog(message) {
  if (!_systemLogElement) {
    _systemLogElement = document.querySelector("#system-log");
  }
  if (!_systemLogElement) return;

  _appendMessage(_systemLogElement, message);
}

export function clearRuntimeLogs() {
  if (_combatLogElement) _combatLogElement.innerHTML = "";
  if (_systemLogElement) _systemLogElement.innerHTML = "";
}

export function initCombatLogUI() {
  if (_initialized) return;

  _combatLogElement = document.querySelector("#combat-log");
  _systemLogElement = document.querySelector("#system-log");

  if (!_combatLogElement || !_systemLogElement) {
    console.warn(
      "[CombatLogUI] combat-log vagy system-log panel nem található.",
    );
    return;
  }

  eventBus.subscribe(EVENTS.COMBAT_ATTACK_START, _onCombatStart, 250);
  eventBus.subscribe(EVENTS.DAMAGE_APPLIED, _onDamageApplied, -100);
  eventBus.subscribe(EVENTS.NARRATION_RECEIVED, _onNarrationReceived, -90);

  _initialized = true;
}
