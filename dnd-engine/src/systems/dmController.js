import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import {
  addQuest,
  completeQuest,
  failQuest,
  getActiveQuests,
} from "./questSystem.js";

let _listenersWired = false;

export function initDM() {
  if (_listenersWired) return;
  _listenersWired = true;

  eventBus.on(EVENTS.PLAYER_CUSTOM_ACTION, ({ text }) => {
    processTurn(text).catch((err) =>
      console.error("[DMController] PLAYER_CUSTOM_ACTION failed:", err),
    );
  });

  console.log("[DMController] Initialised (local deterministic mode).");
}

export async function processTurn(playerAction) {
  const state = gameStore.getState();

  _appendToNarrativeLog("player", playerAction);

  const freshDmState = gameStore.getState().dm;
  gameStore.setState(
    { dm: { ...freshDmState, pendingResponse: true } },
    "dmController",
  );

  const context = buildContext(state, playerAction);
  eventBus.emit(EVENTS.DM_CONTEXT_READY, { context });

  const response = _buildLocalResponse(playerAction);
  _applyDMResponse(response, context);

  const newTurnCount = (gameStore.getState().dm.turnCount ?? 0) + 1;
  gameStore.setState(
    { dm: { ...gameStore.getState().dm, turnCount: newTurnCount } },
    "dmController:turnCount",
  );

  return response;
}

export function buildContext(state, playerAction) {
  return {
    playerAction,
    player: {
      name: state.player.name,
      class: state.player.class,
      level: state.player.level,
      hp: state.player.hp,
      maxHp: state.player.maxHp,
      goldPieces: state.player.gold,
    },
    scene: {
      description: state.world.sceneDescription,
      npcsPresent: state.world.npcsPresent,
      enemiesPresent: state.world.enemiesPresent,
    },
    activeQuests: getActiveQuests().map((q) => ({ id: q.id, title: q.title })),
    recentLog: state.dm.narrativeLog.slice(-8),
  };
}

function _buildLocalResponse(playerAction) {
  const text = String(playerAction ?? "").trim();
  const lower = text.toLowerCase();

  const verbs = [
    "A levegő feszülten megmozdul, ahogy cselekszel.",
    "A környezet visszhangozza a döntésed súlyát.",
    "A történet egy új, sötétebb fordulatot vesz.",
  ];

  const randomLine = verbs[Math.floor(Math.random() * verbs.length)];

  let narrationHu = `Cselekedtél: "${text}". ${randomLine}`;
  let actions = ["Look around", "Continue forward", "Rest", "Check inventory"];

  if (!text) {
    narrationHu = "A csend nyugtalanító; a világ arra vár, hogy lépj.";
  } else if (lower.includes("attack") || lower.includes("támad")) {
    narrationHu =
      "Harci szándékod világos. A helyzet élesedik, és az ellenfelek felkészülnek.";
    actions = ["Engage", "Take cover", "Use ability", "Retreat"];
  } else if (lower.includes("rest") || lower.includes("pihen")) {
    narrationHu =
      "Rövid pihenőt tartasz, de a sötétség nem hagyja, hogy teljesen megnyugodj.";
    actions = ["Stand watch", "Continue journey", "Check supplies", "Pray"];
  } else if (lower.includes("talk") || lower.includes("beszél")) {
    narrationHu =
      "Szavaid óvatosan tapogatják a terepet; valaki figyel, és válaszra készül.";
    actions = ["Ask directly", "Persuade", "Observe reaction", "Leave"];
  }

  return {
    narration_hu: narrationHu,
    narration_en: narrationHu,
    narration: narrationHu,
    worldState: {},
    actions,
    combatTrigger: null,
    quests: null,
    npcUpdates: null,
  };
}

function _applyDMResponse(response, context) {
  if (!response.narration_hu && response.narration) {
    response.narration_hu = response.narration;
    response.narration_en = response.narration;
  }

  const lang = gameStore.getState().settings?.language ?? "hu";
  const displayText =
    lang === "en"
      ? (response.narration_en ?? response.narration ?? "")
      : (response.narration_hu ?? response.narration ?? "");

  _appendToNarrativeLog("dm", displayText);

  const freshState = gameStore.getState();
  gameStore.setState(
    {
      dm: {
        ...freshState.dm,
        pendingResponse: false,
        lastContext: context ?? freshState.dm.lastContext,
      },
      world: { ...freshState.world, availableActions: response.actions ?? [] },
    },
    "dmController:applyResponse",
  );

  if (response.worldState && Object.keys(response.worldState).length > 0) {
    const currentWorld = gameStore.getState().world;
    gameStore.setState(
      {
        world: { ...currentWorld, ...response.worldState },
      },
      "dmController:worldStatePatch",
    );
  }

  if (response.combatTrigger) {
    eventBus.emit(EVENTS.COMBAT_REQUESTED, response.combatTrigger);
  }

  if (Array.isArray(response.quests)) {
    for (const q of response.quests) {
      if (q.action === "add") {
        addQuest({
          id: q.id,
          title: q.title ?? q.id,
          description: q.description ?? "",
          type: q.type ?? "side",
          parentId: q.parentId ?? null,
        });
      } else if (q.action === "complete") {
        completeQuest(q.id);
      } else if (q.action === "fail") {
        failQuest(q.id);
      }
    }
  }

  eventBus.emit(EVENTS.DM_RESPONSE_RECEIVED, response);
}

function _appendToNarrativeLog(role, text) {
  const dm = gameStore.getState().dm;
  gameStore.setState(
    {
      dm: {
        ...dm,
        narrativeLog: [
          ...dm.narrativeLog,
          { role, text, timestamp: Date.now() },
        ],
      },
    },
    "dmController:appendLog",
  );
}
