/**
 * storyManager.js — Static Story & Exploration Engine.
 *
 * RESPONSIBILITIES
 * ─────────────────────────────────────────────────────────────────────────────
 * • Owns the story navigation state (_currentNodeId)
 * • Executes choices by type, delegating to the correct engine module
 * • Bridges story → combat: stores the post-combat destination and
 *   listens to COMBAT_VICTORY to navigate there automatically
 * • Updates the store (world.currentSceneId, world.sceneDescription,
 *   world.storyFlags) so save/load preserves story position
 *
 * DESIGN RULES
 * ─────────────────────────────────────────────────────────────────────────────
 * • Zero knowledge of the DOM — all rendering is done by StoryUI.js
 * • Reads story data only from storyNodes.js (easily swapped for async JSON)
 * • Every state change goes through gameStore.setState() — never mutate directly
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { addItem, modifyGold } from "./inventorySystem.js";
import { completeQuest } from "./questSystem.js";
import { performSkillCheck } from "../engine/actionDispatcher.js";
import { startStaticEncounter } from "../data/encounters.js";
import { shortRest, longRest } from "./restSystem.js";
import { STORY_NODES, STORY_START_NODE } from "../data/storyNodes.js";
import { setMusic, NODE_MUSIC } from "./audioSystem.js";

// ── Module-level state ────────────────────────────────────────────────────────

/** @type {string | null} */
let _currentNodeId = null;

/** Where to navigate after a victorious combat (set per-choice, consumed once). */
let _postCombatNode = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wire event listeners. Call once during bootstrap.
 */
export function initStory() {
  // After victory, navigate to the node that triggered the combat
  eventBus.on(EVENTS.COMBAT_VICTORY, () => {
    if (_postCombatNode) {
      const target = _postCombatNode;
      _postCombatNode = null;
      // Let the Victory modal appear first, then navigate
      setTimeout(() => goTo(target), 200);
    }
  });

  // After defeat, clear the pending post-combat node so we don't navigate
  // to the victory destination if the player reloads and retries
  eventBus.on(EVENTS.COMBAT_DEFEAT, () => {
    _postCombatNode = null;
  });
}

/**
 * Begin the story from a given node (or the default start node).
 * Call after character creation is complete.
 *
 * @param {string} [nodeId]
 */
export function startStory(nodeId = STORY_START_NODE) {
  // If a save was loaded, resume from where the player left off
  const saved = gameStore.getState().world.currentSceneId;
  const resumeId = saved && STORY_NODES[saved] ? saved : nodeId;
  goTo(resumeId);
}

/**
 * Navigate to a specific node.
 * Updates the store, executes onEnter, and emits STORY_NODE_CHANGED.
 *
 * @param {string} nodeId
 */
export function goTo(nodeId) {
  const node = STORY_NODES[nodeId];
  if (!node) {
    console.warn(`[StoryManager] Unknown node id: "${nodeId}"`);
    return;
  }

  _currentNodeId = nodeId;

  // ── Update store ──────────────────────────────────────────────────────────
  const state = gameStore.getState();
  const alreadyVisited = !!(state.world.storyFlags ?? {})[`visited_${nodeId}`];

  gameStore.setState(
    {
      world: {
        ...state.world,
        currentSceneId: nodeId,
        sceneDescription: node.description,
        storyFlags: {
          ...(state.world.storyFlags ?? {}),
          [`visited_${nodeId}`]: true,
        },
      },
    },
    "storyManager:goTo",
  );

  // ── Auto-actions on arrival ───────────────────────────────────────────────
  // Only fire onEnter the FIRST time a node is visited; prevents loot/gold
  // from being re-awarded every time the player navigates back to a node.
  if (node.onEnter && !alreadyVisited) {
    _executeAction(node.onEnter, node);
  }

  // ── Notify UI ─────────────────────────────────────────────────────────────
  eventBus.emit(EVENTS.STORY_NODE_CHANGED, { node, nodeId });
  const _track = NODE_MUSIC[nodeId];
  if (_track) setMusic(_track);
}

/**
 * Execute a player's choice.
 * Called by StoryUI when the player clicks a choice button.
 *
 * @param {import('../data/storyNodes.js').Choice} choice
 */
export function executeChoice(choice) {
  eventBus.emit(EVENTS.STORY_CHOICE_MADE, {
    choice,
    fromNode: _currentNodeId,
  });
  _executeAction(choice);
}

/**
 * Return the current node id (useful for debugging / save systems).
 * @returns {string | null}
 */
export function getCurrentNodeId() {
  return _currentNodeId;
}

// ── Action Dispatcher ─────────────────────────────────────────────────────────

/**
 * Central action executor — handles all StoryNode action types.
 * @private
 */
function _executeAction(action) {
  // Handle arrays of actions (e.g. onEnter: [ {type:"setFlag",...}, {type:"updateQuest",...} ])
  if (Array.isArray(action)) {
    action.forEach((a) => _executeAction(a));
    return;
  }

  switch (action.type) {
    // ── navigate ─────────────────────────────────────────────────────────────
    case "navigate":
      goTo(action.target);
      break;

    // ── combat ───────────────────────────────────────────────────────────────
    case "combat": {
      _postCombatNode = action.victoryNode ?? null;

      const started = startStaticEncounter(action.encounterId);
      if (!started) {
        // Could not start (already in combat, or unknown id).
        // Fall through to victoryNode if set so the story doesn't deadlock.
        if (action.victoryNode) goTo(action.victoryNode);
      }
      break;
    }

    // ── loot ──────────────────────────────────────────────────────────────────
    case "loot": {
      const gold = action.gold ?? 0;
      if (gold > 0) {
        modifyGold(gold);
        if (gold > 0) {
          eventBus.emit(EVENTS.UI_NOTIFICATION, {
            text: `🪙 Found ${gold} gold pieces`,
            type: "success",
            ttl: 2500,
          });
        }
      }

      (action.items ?? []).forEach((item) => {
        const normalised =
          typeof item === "string"
            ? {
                itemId: `story_${item.toLowerCase().replace(/\s+/g, "_")}`,
                name: item,
                quantity: 1,
              }
            : item;
        addItem(normalised);
        eventBus.emit(EVENTS.UI_NOTIFICATION, {
          text: `🗂️ Received: ${normalised.name}${normalised.quantity > 1 ? ` ×${normalised.quantity}` : ""}`,
          type: "info",
          ttl: 2500,
        });
      });

      // Complete quests if the loot action declares them resolved
      (action.completeQuestIds ?? []).forEach((qId) => {
        completeQuest(qId);
      });

      // Navigate after looting (onEnter loot blocks don't usually have then;
      // choice-level loot actions do)
      if (action.then) goTo(action.then);
      break;
    }

    // ── skillCheck ────────────────────────────────────────────────────────────
    case "skillCheck":
      _handleSkillCheck(action);
      break;

    // ── addQuest ──────────────────────────────────────────────────────────────
    case "addQuest": {
      const state = gameStore.getState();
      const quests = [...(state.world.quests ?? [])];

      if (!quests.some((q) => q.id === action.questId)) {
        quests.push({
          id: action.questId,
          title: action.title,
          description: action.description ?? "",
          status: "active",
          addedAt: Date.now(),
        });

        gameStore.setState(
          { world: { ...state.world, quests } },
          "storyManager:addQuest",
        );

        eventBus.emit(EVENTS.QUEST_ADDED, { questId: action.questId });
        eventBus.emit(EVENTS.UI_NOTIFICATION, {
          text: `📜 New Quest: ${action.title}`,
          type: "info",
          ttl: 4000,
        });
      }

      if (action.then) goTo(action.then);
      break;
    }

    // ── shop ──────────────────────────────────────────────────────────────────
    case "shop":
      eventBus.emit(EVENTS.OPEN_SHOP, {
        merchantName: action.merchantName ?? "Merchant",
        items: action.items ?? [],
      });
      break;

    // ── rest ──────────────────────────────────────────────────────────────────
    case "rest": {
      const isLong = action.restType === "long";
      const result = isLong ? longRest() : shortRest();
      const icon = isLong ? "🌙" : "⛺️";
      const label = isLong ? "Long Rest" : "Short Rest";
      const { player } = gameStore.getState();
      eventBus.emit(EVENTS.UI_NOTIFICATION, {
        text: `${icon} ${label} — +${result.hpRestored} HP${result.manaRestored > 0 ? `, +${result.manaRestored} MP` : ""} (${result.newHp}/${player.maxHp} HP)`,
      });
      if (action.navigateTo) goTo(action.navigateTo);
      break;
    }

    // ── setFlag ───────────────────────────────────────────────────────────────
    case "setFlag": {
      const st = gameStore.getState();
      gameStore.setState(
        {
          world: {
            ...st.world,
            storyFlags: {
              ...(st.world.storyFlags ?? {}),
              [action.flag]: action.value ?? true,
            },
          },
        },
        "storyManager:setFlag",
      );
      if (action.then) goTo(action.then);
      break;
    }

    // ── updateQuest ──────────────────────────────────────────────────────────
    case "updateQuest": {
      const stQ = gameStore.getState();
      const quests = (stQ.world.quests ?? []).map((q) =>
        q.id === action.questId
          ? { ...q, ...action.patch, status: action.status ?? q.status }
          : q,
      );
      gameStore.setState(
        { world: { ...stQ.world, quests } },
        "storyManager:updateQuest",
      );
      if (action.status === "completed") {
        eventBus.emit(EVENTS.UI_NOTIFICATION, {
          text: `✅ Quest completed: ${quests.find((q) => q.id === action.questId)?.title ?? action.questId}`,
          type: "success",
          ttl: 3000,
        });
      }
      if (action.then) goTo(action.then);
      break;
    }

    default:
      console.warn(`[StoryManager] Unhandled action type: "${action.type}"`);
  }
}

/**
 * Perform a D20 skill check and navigate to the correct node based on result.
 * @private
 */
async function _handleSkillCheck(choice) {
  // Disable UI choices while the roll is in progress
  eventBus.emit(EVENTS.STORY_SKILL_CHECK_START, {
    skill: choice.skill,
    dc: choice.dc,
  });

  let checkResult;
  try {
    checkResult = await performSkillCheck(choice.skill, choice.dc);
  } catch (err) {
    console.error("[StoryManager] Skill check error:", err);
    checkResult = null;
  }

  const success = checkResult?.success ?? false;
  const rolled = checkResult?.result?.total ?? "?";

  eventBus.emit(EVENTS.UI_NOTIFICATION, {
    text: `🎲 ${_capitalise(choice.skill)} check DC ${choice.dc}: rolled ${rolled} — ${success ? "✅ Success!" : "❌ Failure"}`,
    type: success ? "success" : "error",
    ttl: 3500,
  });

  eventBus.emit(EVENTS.STORY_SKILL_CHECK_END, { success, rolled, choice });

  const nextNode = success ? choice.successNode : choice.failNode;
  if (nextNode) goTo(nextNode);
  // Note: processTurn is intentionally NOT called here — the DM AI would
  // sometimes auto-trigger COMBAT_REQUESTED without _postCombatNode being set,
  // which permanently froze the story after that combat ended.
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
