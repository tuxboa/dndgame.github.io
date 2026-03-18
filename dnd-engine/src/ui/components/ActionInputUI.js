/**
 * ActionInputUI.js
 *
 * Owns the player free-text input row at the bottom of the game shell.
 * Replaces the static wiring in main.js wireUI() with a proper component
 * that:
 *   • Emits USER_INPUT_SUBMITTED when the player submits an action.
 *   • Shows a loading state (disables input + changes button label) while
 *     the DM is processing.
 *
 * Mount: call initActionInput() once in bootstrap, after renderUI().
 * The component operates on the existing DOM elements #player-input +
 * #btn-send injected by renderUI() — no extra markup needed.
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";

// ── Labels ────────────────────────────────────────────────────────────────────

const BTN_IDLE = "▶";
const BTN_LOADING = "Gondolkodik a DM...";
const BTN_WAITING = "Várakozás a dobásra...";
const PH_IDLE = "What do you want to do?";
const PH_LOADING = "Gondolkodik a DM...";
const PH_WAITING = "Várakozás a dobásra...";

// Prevent double-registration if called more than once
let _wired = false;
let _pending = false;
let _awaitingRoll = false;

function _renderLoadingState(input, btn) {
  const isBusy = _pending;
  const waitingRoll = _pending && _awaitingRoll;

  input.disabled = isBusy;
  btn.disabled = isBusy;
  btn.textContent = waitingRoll ? BTN_WAITING : isBusy ? BTN_LOADING : BTN_IDLE;
  input.placeholder = waitingRoll
    ? PH_WAITING
    : isBusy
      ? PH_LOADING
      : PH_IDLE;
  btn.classList.toggle("btn-send--loading", isBusy);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialise the action input component.
 * Safe to call from bootstrap — idempotent.
 */
export function initActionInput() {
  if (_wired) return;

  const input = /** @type {HTMLInputElement}  */ (
    document.querySelector("#player-input")
  );
  const btn = /** @type {HTMLButtonElement} */ (
    document.querySelector("#btn-send")
  );

  if (!input || !btn) {
    console.warn(
      "[ActionInputUI] #player-input or #btn-send not found in DOM.",
    );
    return;
  }

  // Update placeholder to match new purpose
  input.placeholder = PH_IDLE;
  _renderLoadingState(input, btn);

  // ── Submission handler ───────────────────────────────────────────────────
  const submit = async () => {
    const text = input.value.trim();
    if (!text) return;
    if (gameStore.getState().dm.pendingResponse) return; // guard against race

    input.value = "";
    input.blur();

    await eventBus.publish(EVENTS.USER_INPUT_SUBMITTED, {
      text,
      source: "action-input",
    });
  };

  btn.addEventListener("click", () => {
    void submit();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  });

  // ── Loading-state subscription ───────────────────────────────────────────
  gameStore.select(
    (s) => s.dm.pendingResponse,
    (pending) => {
      _pending = pending;
      _renderLoadingState(input, btn);
    },
  );

  gameStore.select(
    (s) => s.dm.awaitingRoll,
    (awaitingRoll) => {
      _awaitingRoll = awaitingRoll;
      _renderLoadingState(input, btn);
    },
  );

  _wired = true;
  console.log("[ActionInputUI] Initialised.");
}
