/**
 * The single source of truth for all game state.
 *
 * RULES:
 * 1. UI components may only READ via getState() or subscribe()
 * 2. Only systems/ and engine/ modules call setState()
 * 3. State must always be pure JSON (no functions, no DOM refs)
 *    → This makes save/load and WebSocket sync "free"
 */

function createStore(initialState) {
  let _state = structuredClone(initialState);
  const _listeners = new Set();
  const _history = []; // Capped at 20 — for dev undo/replay

  return {
    /**
     * Get a frozen snapshot. UI cannot accidentally mutate it.
     * @returns {Readonly<GameState>}
     */
    getState() {
      return Object.freeze(structuredClone(_state));
    },

    /**
     * Apply a partial state update (shallow merge at top level).
     * For nested updates, spread the sub-object manually:
     *   setState({ player: { ...getState().player, hp: 10 } })
     *
     * @param {Partial<GameState>} patch
     * @param {string} [source] - Label for the dev history log
     */
    setState(patch, source = "unknown") {
      if (import.meta.env.DEV) {
        _history.push({ patch, source, timestamp: Date.now() });
        if (_history.length > 20) _history.shift();
      }

      _state = { ..._state, ...patch };
      _listeners.forEach((fn) => fn(Object.freeze(structuredClone(_state))));
    },

    /**
     * Subscribe to all state changes.
     * Immediately calls listener with current state (useful for initial render).
     * @param {Function} listener
     * @returns {Function} unsubscribe
     */
    subscribe(listener) {
      _listeners.add(listener);
      listener(this.getState());
      return () => _listeners.delete(listener);
    },

    /**
     * Subscribe to a single derived value only.
     * Listener only fires when the selected value actually changes.
     *
     * @param {(state: GameState) => any} selector
     * @param {Function} listener
     * @returns {Function} unsubscribe
     *
     * @example
     * gameStore.select(s => s.player.hp, hp => renderHealthBar(hp));
     */
    select(selector, listener) {
      let prev = selector(_state);
      return this.subscribe((state) => {
        const next = selector(state);
        if (next !== prev) {
          prev = next;
          listener(next, state);
        }
      });
    },

    getHistory: () => [..._history],
  };
}

export const gameStore = createStore({
  // ── Player ──────────────────────────────────────────────────────
  player: {
    id: null,
    name: "",
    class: "",
    race: "",
    level: 1,
    hp: 0,
    maxHp: 0,
    ac: 10,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {}, // { athletics: { proficient: true, expertise: false } }
    inventory: [], // [{ itemId, name, quantity, equipped, description }]
    gold: 0,
    spellSlots: {}, // { 1: { used: 0, total: 2 } }
    conditions: [], // ['poisoned', 'prone', ...]
    mana: 0, // Current mana points
    maxMana: 0, // Max mana points (set by spellSystem.initMana per class)
    knownSpells: [], // string[] spell ids — populated from CLASS_SPELLS on init
    proficiencyBonus: 2,
    xp: 0,
    attackBonus: 0, // Sum of all equipment attack bonuses (updated by equipmentSystem)
    baseAc: null, // AC before any equipment bonuses (snapshot taken by initEquipment)
    baseMaxHp: null, // maxHp before any equipment bonuses
    baseMaxMana: null, // maxMana before any equipment bonuses
    equipment: {
      // Current item in each slot: { itemId, name } | null
      weapon: null,
      armor: null,
      accessory: null,
      offhand: null, // Shield or sidearm weapon (equippable alongside armor)
    },
    deathSaves: { successes: 0, failures: 0 }, // 3 failures = dead, 3 successes = stable
    deathSaveActive: false, // Currently rolling death saves (knocked to 0 HP)
    feats: [], // string[] — feat ids taken during level-up
    luckPoints: 0, // Lucky feat: reroll tokens remaining (reset on long rest)
    tempHp: 0, // Temporary HP — absorbs damage before real HP
    concentration: null, // null | { spellId: string, spellName: string }
    // Class-specific resource tracking (reset on rest by restSystem)
    classAbilities: {
      secondWindUsed: false, // Fighter: used since last short rest
      rageActive: false, // Barbarian: rage currently active
      rageRoundsLeft: 0, // Barbarian: turns remaining in current rage
      rageUses: 2, // Barbarian: uses remaining until long rest
      kiPoints: 0, // Monk: current ki points
      maxKiPoints: 0, // Monk: max ki points (set on init)
      bardInspirationUsed: false, // Bard: inspiration used since last short rest
      bardBonusDie: 0, // Bard: active Inspiration die value (0 = inactive)
      smitePending: false, // Paladin: Divine Smite armed for next hit
      hunterMarkTarget: null, // Ranger: ID of marked target (null = no mark)
      reactionAvailable: true, // Whether the player has used their reaction this round
      extraAttackUsedThisTurn: false, // Extra Attack (level 5+ feature) used flag
      offhandUsed: false, // Off-hand attack (bonus action) used this turn
    },
  },

  // ── World / Scene ────────────────────────────────────────────────
  world: {
    currentSceneId: null,
    sceneDescription: "",
    storyFlags: {}, // Key-value flags set by story nodes (persisted with save)
    availableActions: [], // What the player can legally do right now
    npcsPresent: [], // [{ id, name, disposition }]
    enemiesPresent: [], // [{ id, name, hp, maxHp, ac }]
    discoveredLocations: [],
    quests: [], // [{ id, title, description, status: 'active'|'completed'|'failed', addedAt }]
    // NPC relációk — a DM frissíti, a mentés perzisztálja
    // { [npcId]: { name: string, disposition: 'friendly'|'neutral'|'hostile', notes: string[] } }
    npcRelationships: {},
  },

  // ── Combat ───────────────────────────────────────────────────────
  combat: {
    active: false,
    round: 0,
    turnOrder: [], // [{ id, name, initiative, isPlayer, x, y, movementSpeed, movementRemaining, weaponRange }]
    currentTurnIndex: 0,
    currentTurnActorId: null, // ID of the combatant whose turn it currently is
    log: [], // [{ round, actor, action, result, timestamp }]
    // ── Tactical Grid Map ──────────────────────────────────────────
    map: {
      cols: 20, // grid columns
      rows: 14, // grid rows
      cellSize: 48, // pixels per cell (logical canvas resolution)
      backgroundImage: null, // URL for the battle-map image layer
      mapType: null, // terrain type override: 'sewer'|'forest'|'grassland'|'road'|'dungeon_room'|'cobblestone'|'boss_room'
    },
  },

  // ── DM / LLM ─────────────────────────────────────────────────────
  dm: {
    campaignLayers: null, // Loaded from campaign.json by CampaignLoader
    narrativeLog: [], // [{ role: 'dm'|'player', text, timestamp }]
    pendingResponse: false,
    lastContext: null, // The context object sent to LLM last turn
    storySoFar: "", // Rolling compressed summary of past turns (memory buffer)
    turnCount: 0, // Increments each processTurn() — used to trigger summarization
  },

  // ── Session (multiplayer-ready) ───────────────────────────────────
  session: {
    id: null,
    mode: "solo", // 'solo' | 'coop'
    players: [], // [{ id, name, isConnected, isReady }]
    localPlayerId: null,
    currentTurnPlayerId: null,
    isMyTurn: true, // Always true in solo
  },

  // ── Campaign Content ──────────────────────────────────────────────
  // Populated by CampaignLoader from campaign.json page layers.
  // Read-only at runtime — never mutated by gameplay systems.
  campaign: {
    enemies: {}, // { typeId: EnemyTemplate } — { name, baseHp, baseDmg, damageDie, ac, attackBonus, xpReward, goldReward, lootTable }
    locations: {}, // { locationId: Location }  — { name, description, paths, enemyType, npcs }
    questDefs: {}, // { questId: QuestDefinition } — full definitions from campaign.json
    activeAdventure: null, // The first adventure found (startLocation, autoStartQuests, etc.)
  },

  // ── Trade ────────────────────────────────────────────────────────
  trade: {
    active: false,
    counterpartyId: null,
    counterpartyName: "",
    offeredItems: [], // Items local player offers
    requestedItems: [], // Items local player wants
    status: null, // null | 'pending' | 'accepted' | 'rejected'
  },
  // ── Settings ────────────────────────────────────────────────────────────
  settings: {
    language:
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("dnd_lang")
        : null) ?? "hu",
  },
  // ── UI ────────────────────────────────────────────────────────────────────
  ui: {
    activePanel: "narrative", // 'narrative' | 'inventory' | 'character' | 'map'
    diceModal: {
      open: false,
      purpose: null, // 'attack' | 'skill_check' | 'saving_throw' | ...
      notation: null,
      pendingResult: null,
    },
    notifications: [], // [{ id, text, type, ttl }]
  },
});
