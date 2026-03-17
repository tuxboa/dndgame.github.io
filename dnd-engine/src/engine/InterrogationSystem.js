import { eventBus, EVENTS } from "./eventBus.js";
import { geminiDMService } from "../services/GeminiDMService.js";
import { campaignManager } from "./CampaignManager.js";

let _initialized = false;

function _emitNarrative(text) {
  if (!text) return;
  eventBus.emit(EVENTS.NARRATIVE_UPDATE, {
    text,
    role: "dm",
  });
}

function _normaliseResponse(response) {
  if (!response || typeof response !== "object") {
    return {
      narrative: "Az őr értetlenül néz rád.",
      action: "STAY",
      payload: null,
    };
  }

  return {
    narrative: String(response.narrative ?? "").trim(),
    action: String(response.action ?? "STAY")
      .trim()
      .toUpperCase(),
    payload: response.payload ?? null,
  };
}

async function _handleInput({ text, sceneContext }) {
  const input = String(text ?? "").trim();
  if (!input) return;

  const context = sceneContext ?? campaignManager.getCurrentSceneContext();
  if (!context || context.type !== "interrogation") return;

  let response;
  try {
    response = geminiDMService?.reasonPlayerIntent
      ? await geminiDMService.reasonPlayerIntent(input, context)
      : {
          narrative: "Az őr szótlanul méreget, mintha semmit sem hinné el.",
          action: "STAY",
          payload: null,
        };
  } catch (error) {
    console.error("[InterrogationSystem] Intent feldolgozási hiba:", error);
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: "A kihallgatás közben hiba történt. Próbáld újra.",
      type: "error",
      ttl: 3500,
    });
    return;
  }

  const normalised = _normaliseResponse(response);
  _emitNarrative(normalised.narrative);

  if (normalised.action === "SET_FLAG" && normalised.payload) {
    campaignManager.updateState({ flags: normalised.payload });
    return;
  }

  if (normalised.action === "COMBAT_TRIGGERED" && normalised.payload) {
    if (normalised.payload.sceneId) {
      campaignManager.goToScene(normalised.payload.sceneId);
      return;
    }

    if (normalised.payload.encounterId) {
      eventBus.emit(EVENTS.COMBAT_TRIGGERED, {
        encounterId: normalised.payload.encounterId,
      });
      return;
    }
  }

  if (normalised.action === "LEAVE") {
    if (context.onLeave) {
      campaignManager.goToScene(context.onLeave);
    }
  }
}

export function initInterrogationSystem() {
  if (_initialized) return;
  _initialized = true;

  eventBus.on(EVENTS.PLAYER_INPUT_SUBMITTED, (payload) => {
    void _handleInput(payload);
  });
}
