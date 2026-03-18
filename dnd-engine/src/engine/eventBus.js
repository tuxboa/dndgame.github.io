/**
 * Central pub/sub event bus.
 * Systems communicate through here — never by importing each other directly.
 * In multiplayer: server messages arrive here via NetworkBridge.
 */

/**
 * @typedef {Object} EventListenerEntry
 * @property {Function} callback
 * @property {number} priority
 * @property {number} order
 */

const _handlers = new Map();
let _listenerOrder = 0;

/**
 * Normalize priority argument passed to on/once.
 * Supported forms:
 *   - number (e.g. 10)
 *   - { priority: number }
 *   - undefined (defaults to 0)
 *
 * @param {number | {priority?: number} | undefined} priorityOrOptions
 * @returns {number}
 */
function _normalizePriority(priorityOrOptions) {
  if (typeof priorityOrOptions === "number") return priorityOrOptions;
  if (priorityOrOptions && typeof priorityOrOptions.priority === "number") {
    return priorityOrOptions.priority;
  }
  return 0;
}

/**
 * Insert a listener and keep execution order deterministic:
 * 1) higher priority first
 * 2) for same priority, earlier subscription first
 *
 * @param {string} event
 * @param {Function} callback
 * @param {number} priority
 */
function _addListener(event, callback, priority) {
  if (!_handlers.has(event)) _handlers.set(event, []);

  const listeners = _handlers.get(event);
  listeners.push({
    callback,
    priority,
    order: _listenerOrder++,
  });

  listeners.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.order - b.order;
  });
}

/**
 * Remove listener entries for an exact callback reference.
 *
 * @param {string} event
 * @param {Function} callback
 * @returns {number} number of removed listener entries
 */
function _removeListener(event, callback) {
  const listeners = _handlers.get(event);
  if (!listeners?.length) return 0;

  const before = listeners.length;
  const next = listeners.filter((entry) => entry.callback !== callback);

  if (next.length === 0) {
    _handlers.delete(event);
  } else {
    _handlers.set(event, next);
  }

  return before - next.length;
}

export const eventBus = {
  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @param {number|{priority?: number}} [priorityOrOptions=0]
   * @returns {Function} unsubscribe — call to clean up
   */
  on(event, handler, priorityOrOptions = 0) {
    const priority = _normalizePriority(priorityOrOptions);
    _addListener(event, handler, priority);
    return () => this.off(event, handler);
  },

  /**
   * Alias for on() to match classic EventBus naming.
   */
  subscribe(event, handler, priorityOrOptions = 0) {
    return this.on(event, handler, priorityOrOptions);
  },

  /**
   * Unsubscribe one callback from an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {boolean}
   */
  off(event, handler) {
    return _removeListener(event, handler) > 0;
  },

  /**
   * Alias for off() to match classic EventBus naming.
   */
  unsubscribe(event, handler) {
    return this.off(event, handler);
  },

  /**
   * Subscribe once — auto-removes after first call.
   */
  once(event, handler, priorityOrOptions = 0) {
    const priority = _normalizePriority(priorityOrOptions);
    const unsub = this.on(
      event,
      (payload) => {
        unsub(); // unsubscribe first so a throwing handler doesn't leave it stuck
        return handler(payload);
      },
      priority,
    );
    return unsub;
  },

  /**
   * Emit an event to all subscribers.
   * Each handler is isolated — one crash won't prevent the rest from running.
   */
  emit(event, payload) {
    const listeners = _handlers.get(event);
    if (!listeners?.length) return;

    // Snapshot protects against mutation while iterating (unsubscribe inside handler).
    [...listeners].forEach((entry) => {
      try {
        const maybePromise = entry.callback(payload);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.catch((err) => {
            console.error(
              `[EventBus] Async handler for "${event}" threw:`,
              err,
            );
          });
        }
      } catch (err) {
        console.error(`[EventBus] Handler for "${event}" threw:`, err);
      }
    });
  },

  /**
   * Publish event asynchronously in strict priority order.
   * Awaits each listener before invoking the next one.
   */
  async publish(event, payload) {
    const listeners = _handlers.get(event);
    if (!listeners?.length) return;

    // Snapshot protects against mutation while iterating (unsubscribe inside handler).
    for (const entry of [...listeners]) {
      try {
        await entry.callback(payload);
      } catch (err) {
        console.error(`[EventBus] Handler for "${event}" threw:`, err);
      }
    }
  },

  /**
   * Number of listeners currently attached to one event.
   * @param {string} event
   */
  listenerCount(event) {
    return _handlers.get(event)?.length ?? 0;
  },

  /**
   * Remove listeners.
   * If event is omitted, clears everything.
   * If event is provided, clears only that event.
   * @param {string} [event]
   */
  clear(event) {
    if (event) {
      _handlers.delete(event);
      return;
    }
    _handlers.clear();
  },

  /**
   * Enable debug logging of all events (dev only).
   */
  debug() {
    const originalEmit = this.emit.bind(this);
    const originalPublish = this.publish.bind(this);
    this.emit = (event, payload) => {
      console.log(`[EventBus] ${event}`, payload);
      originalEmit(event, payload);
    };
    this.publish = async (event, payload) => {
      console.log(`[EventBus] ${event}`, payload);
      await originalPublish(event, payload);
    };
  },
};

/**
 * All event type constants — single source of truth.
 * Never use raw strings for event names outside this file.
 */
export const EVENTS = {
  // ── Dice ─────────────────────────────────────────────────────────
  DICE_ROLL_REQUESTED: "dice:rollRequested",
  DICE_ROLL_COMPLETED: "dice:rollCompleted",
  DICE_ANIMATE: "dice:animate",

  // ── Combat ───────────────────────────────────────────────────────
  COMBAT_REQUESTED: "combat:requested", // { enemies: [...] } — DM wants to start a fight
  COMBAT_STARTED: "combat:started",
  COMBAT_TURN_START: "combat:turnStart",
  COMBAT_ACTION: "combat:action",
  COMBAT_HIT: "combat:hit",
  COMBAT_MISS: "combat:miss",
  COMBAT_ENDED: "combat:ended",
  COMBAT_VICTORY: "combat:victory", // All enemies dead
  COMBAT_DEFEAT: "combat:defeat", // Player knocked out / dead
  PLAYER_DAMAGED: "combat:playerDamaged",
  PLAYER_KNOCKED_OUT: "combat:playerKnockedOut",
  COMBATANT_DAMAGED: "combat:combatantDamaged", // { targetId, damage, isCrit }
  STATUS_EFFECT_APPLIED: "combat:statusEffectApplied", // { targetId, effect }
  STATUS_EFFECT_TICKED: "combat:statusEffectTicked", // { targetId, effectId, delta }
  CONCENTRATION_BROKEN: "combat:concentrationBroken", // { spellId, spellName }
  OPPORTUNITY_ATTACK: "combat:opportunityAttack", // { enemyId, enemyName }
  TEMP_HP_ABSORBED: "combat:tempHpAbsorbed", // { targetId, absorbed, remaining }
  COMBAT_MAP_MOVE: "combat:mapMove", // { participantId, fromX, fromY, toX, toY }
  COMBAT_MAP_ATTACK_RANGE_INVALID: "combat:mapAttackRangeInvalid", // { targetId, distance, range }
  COMBAT_ATTACK_START: "combat:attackStart", // async attack pre-processing (e.g. animation) before attackDamage
  DAMAGE_APPLIED: "combat:damageApplied", // mutable payload pipeline (armor -> damage -> logging)

  // ── DM / LLM ─────────────────────────────────────────────────────
  DM_CONTEXT_READY: "dm:contextReady",
  DM_RESPONSE_RECEIVED: "dm:responseReceived",
  DM_NARRATIVE_CHUNK: "dm:narrativeChunk", // streaming
  NARRATION_RECEIVED: "NARRATION_RECEIVED",

  // ── Inventory / Trade ────────────────────────────────────────────
  INVENTORY_CHANGED: "inventory:changed",
  TRADE_PROPOSED: "trade:proposed",
  TRADE_ACCEPTED: "trade:accepted",
  TRADE_CANCELLED: "trade:cancelled",

  // ── Quests ───────────────────────────────────────────────────────
  QUEST_ADDED: "quest:added",
  QUEST_COMPLETED: "quest:completed",
  QUEST_FAILED: "quest:failed",

  // ── Session (multiplayer-ready) ───────────────────────────────────
  SESSION_JOINED: "session:joined",
  SESSION_TURN_CHANGED: "session:turnChanged",
  PLAYER_CONNECTED: "session:playerConnected",
  PLAYER_DISCONNECTED: "session:playerDisconnected",

  // ── UI ───────────────────────────────────────────────────────────
  UI_PANEL_CHANGED: "ui:panelChanged",
  UI_DICE_MODAL_OPEN: "ui:diceModalOpen",
  UI_DICE_MODAL_CLOSE: "ui:diceModalClose",
  UI_NOTIFICATION: "ui:notification",

  // ── Story Engine ─────────────────────────────────────────────────
  STORY_NODE_CHANGED: "story:nodeChanged",
  STORY_CHOICE_MADE: "story:choiceMade",
  STORY_SKILL_CHECK_START: "story:skillCheckStart",
  STORY_SKILL_CHECK_END: "story:skillCheckEnd",
  SCENE_LOADED: "story:sceneLoaded",
  COMBAT_TRIGGERED: "story:combatTriggered",
  STATE_CHANGED: "story:stateChanged",
  CAMPAIGN_LOADED: "story:campaignLoaded",
  FLAG_CHANGED: "story:flagChanged",
  CHRONICLE_UPDATED: "story:chronicleUpdated",
  PLAYER_INPUT_SUBMITTED: "story:playerInputSubmitted",
  NARRATIVE_UPDATE: "story:narrativeUpdate",
  ATMOSPHERE_CHANGED: "story:atmosphereChanged",
  // ── Player Actions ─────────────────────────────────────────────────────────
  PLAYER_CUSTOM_ACTION: "player:customAction", // { text } — free-text input
  // ── Spells & Abilities ────────────────────────────────────────────
  SPELL_CAST: "spell:cast",
  MANA_CHANGED: "spell:manaChanged",

  // ── Equipment ─────────────────────────────────────────────────────
  ITEM_EQUIPPED: "equipment:equipped",
  ITEM_UNEQUIPPED: "equipment:unequipped",
  // ── Progression ───────────────────────────────────────────────────────────
  LEVEL_UP_READY: "player:levelUpReady", // Emitted by addXp when threshold hit
  MAGICAL_SECRETS_READY: "player:magicalSecretsReady", // { count, availableSpells }

  // ── Rest ──────────────────────────────────────────────────────────────────
  REST_COMPLETED: "player:restCompleted", // { restType, hpRestored, manaRestored, newHp, newMana }

  // ── NPC ─────────────────────────────────────────────────────────
  NPC_UPDATED: "npc:updated", // { npcId, name, disposition, note }

  // ── Shop ────────────────────────────────────────────────────────────────
  OPEN_SHOP: "shop:open", // payload: { merchantName, items }
  SHOP_CLOSED: "shop:closed",
};
