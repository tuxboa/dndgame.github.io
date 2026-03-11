/**
 * Central pub/sub event bus.
 * Systems communicate through here — never by importing each other directly.
 * In multiplayer: server messages arrive here via NetworkBridge.
 */

const _handlers = new Map();

export const eventBus = {
  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe — call to clean up
   */
  on(event, handler) {
    if (!_handlers.has(event)) _handlers.set(event, new Set());
    _handlers.get(event).add(handler);
    return () => _handlers.get(event).delete(handler);
  },

  /**
   * Subscribe once — auto-removes after first call.
   */
  once(event, handler) {
    const unsub = this.on(event, (payload) => {
      unsub(); // unsubscribe first so a throwing handler doesn't leave it stuck
      handler(payload);
    });
    return unsub;
  },

  /**
   * Emit an event to all subscribers.
   * Each handler is isolated — one crash won't prevent the rest from running.
   */
  emit(event, payload) {
    _handlers.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] Handler for "${event}" threw:`, err);
      }
    });
  },

  /**
   * Enable debug logging of all events (dev only).
   */
  debug() {
    const originalEmit = this.emit.bind(this);
    this.emit = (event, payload) => {
      console.log(`[EventBus] ${event}`, payload);
      originalEmit(event, payload);
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

  // ── DM / LLM ─────────────────────────────────────────────────────
  DM_CONTEXT_READY: "dm:contextReady",
  DM_RESPONSE_RECEIVED: "dm:responseReceived",
  DM_NARRATIVE_CHUNK: "dm:narrativeChunk", // streaming

  // ── Text-to-Speech ───────────────────────────────────────────────
  TTS_SPEAK: "tts:speak", // { text } — playback started
  TTS_STOPPED: "tts:stopped", // {} — stop() called explicitly
  TTS_MUTE_CHANGED: "tts:muteChanged", // { muted: boolean }

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
