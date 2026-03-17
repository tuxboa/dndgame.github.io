/**
 * ActionInputUI.js
 *
 * Owns the player free-text input row at the bottom of the game shell.
 * Replaces the static wiring in main.js wireUI() with a proper component
 * that:
 *   • Emits PLAYER_CUSTOM_ACTION when the player submits an action.
 *   • Shows a loading state (disables input + changes button label) while
 *     the DM is processing.
 *
 * Mount: call initActionInput() once in bootstrap, after renderUI().
 * The component operates on the existing DOM elements #player-input +
 * #btn-send injected by renderUI() — no extra markup needed.
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";
import { campaignManager } from "../../engine/CampaignManager.js";

// ── Labels ────────────────────────────────────────────────────────────────────

const BTN_IDLE = "▶";
const BTN_LOADING = "⏳ Thinking…";
const PH_IDLE = "What do you want to do?";
const PH_LOADING = "The DM is thinking…";

// Prevent double-registration if called more than once
let _wired = false;

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

  // ── Submission handler ───────────────────────────────────────────────────
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    if (gameStore.getState().dm.pendingResponse) return; // guard against race

    input.value = "";
    input.blur();

    const sceneContext = campaignManager.getCurrentSceneContext?.();
    const isInterrogation = sceneContext?.type === "interrogation";

    if (isInterrogation) {
      eventBus.emit(EVENTS.NARRATIVE_UPDATE, {
        text,
        role: "player",
      });

      eventBus.emit(EVENTS.PLAYER_INPUT_SUBMITTED, {
        text,
        sceneContext,
      });
      return;
    }

    // Emit — dmController and any other listener handles the LLM call
    eventBus.emit(EVENTS.PLAYER_CUSTOM_ACTION, { text });
  };

  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  // ── Loading-state subscription ───────────────────────────────────────────
  gameStore.select(
    (s) => s.dm.pendingResponse,
    (pending) => {
      input.disabled = pending;
      btn.disabled = pending;
      btn.textContent = pending ? BTN_LOADING : BTN_IDLE;
      input.placeholder = pending ? PH_LOADING : PH_IDLE;
      btn.classList.toggle("btn-send--loading", pending);
    },
  );

  _wired = true;
  console.log("[ActionInputUI] Initialised.");
}
