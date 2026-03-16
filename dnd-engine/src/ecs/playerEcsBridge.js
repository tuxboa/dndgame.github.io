import { gameStore } from "../store/index.js";
import {
  COMPONENTS,
  PLAYER_ENTITY_ID,
  createAttributesComponent,
  createEquipmentComponent,
  createHealthComponent,
  createIdentityComponent,
  createInventoryComponent,
  createMagicComponent,
  createPlayerControlledComponent,
  createPositionComponent,
  createProgressionComponent,
  createRenderableComponent,
  createVelocityComponent,
  inventoryArrayToMap,
  inventoryMapToArray,
} from "./components.js";
import { ECSWorld } from "./world.js";
import {
  applyDamageToEntity,
  healEntity,
  runHealthClampSystem,
  runInputSystem,
  runMovementSystem,
} from "./systems.js";

const _world = new ECSWorld();

let _initialized = false;
let _unsubscribe = null;
let _isCommittingToStore = false;

function _ensurePlayerEntity() {
  _world.createEntity(PLAYER_ENTITY_ID);

  if (!_world.hasComponent(PLAYER_ENTITY_ID, COMPONENTS.PLAYER_CONTROLLED)) {
    _world.setComponent(
      PLAYER_ENTITY_ID,
      COMPONENTS.PLAYER_CONTROLLED,
      createPlayerControlledComponent(),
    );
  }
}

function _syncStorePlayerToEcs(player) {
  _ensurePlayerEntity();

  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.IDENTITY,
    createIdentityComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.ATTRIBUTES,
    createAttributesComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.HEALTH,
    createHealthComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.INVENTORY,
    createInventoryComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.EQUIPMENT,
    createEquipmentComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.MAGIC,
    createMagicComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.PROGRESSION,
    createProgressionComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.POSITION,
    createPositionComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.VELOCITY,
    createVelocityComponent(player),
  );
  _world.setComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.RENDERABLE,
    createRenderableComponent(player),
  );
}

function _composePlayerFromEcs(basePlayer = {}) {
  _ensurePlayerEntity();

  const identity =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.IDENTITY) ??
    createIdentityComponent(basePlayer);
  const attributes =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.ATTRIBUTES) ??
    createAttributesComponent(basePlayer);
  const health =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.HEALTH) ??
    createHealthComponent(basePlayer);
  const inventory =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.INVENTORY) ??
    createInventoryComponent(basePlayer);
  const equipment =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.EQUIPMENT) ??
    createEquipmentComponent(basePlayer);
  const magic =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.MAGIC) ??
    createMagicComponent(basePlayer);
  const progression =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.PROGRESSION) ??
    createProgressionComponent(basePlayer);
  const position =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.POSITION) ??
    createPositionComponent(basePlayer);
  const velocity =
    _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.VELOCITY) ??
    createVelocityComponent(basePlayer);

  const player = {
    ...basePlayer,

    id: identity.id,
    name: identity.name,
    class: identity.class,
    race: identity.race,
    level: identity.level,

    hp: health.current,
    maxHp: health.max,
    tempHp: health.tempHp,
    baseMaxHp: health.baseMaxHp,
    deathSaves: structuredClone(health.deathSaves),
    deathSaveActive: health.deathSaveActive,

    ac: attributes.ac,
    attackBonus: attributes.attackBonus,
    proficiencyBonus: attributes.proficiencyBonus,
    abilities: structuredClone(attributes.abilities),
    skills: structuredClone(attributes.skills),
    conditions: [...attributes.conditions],
    concentration:
      attributes.concentration != null
        ? structuredClone(attributes.concentration)
        : null,
    dodging: attributes.dodging,

    inventory: inventoryMapToArray(inventory.items),
    gold: inventory.gold,

    equipment: structuredClone(equipment.equipment),
    baseAc: equipment.baseAc,

    mana: magic.mana,
    maxMana: magic.maxMana,
    baseMaxMana: magic.baseMaxMana,
    spellSlots: structuredClone(magic.spellSlots),
    knownSpells: [...magic.knownSpells],
    classAbilities: structuredClone(magic.classAbilities),

    xp: progression.xp,
    feats: [...progression.feats],
    luckPoints: progression.luckPoints,

    x: position.x,
    y: position.y,
    movementSpeed: velocity.speed,
  };

  return player;
}

function _commitPlayer(source) {
  const state = gameStore.getState();
  const player = _composePlayerFromEcs(state.player);

  _isCommittingToStore = true;
  try {
    gameStore.setState({ player }, source);
  } finally {
    _isCommittingToStore = false;
  }
}

function _ensureInitialized() {
  if (!_initialized) {
    initPlayerEcsBridge();
  }
}

export function initPlayerEcsBridge() {
  if (_initialized) return;

  _syncStorePlayerToEcs(gameStore.getState().player);
  _unsubscribe = gameStore.select(
    (state) => state.player,
    (player) => {
      if (_isCommittingToStore) return;
      _syncStorePlayerToEcs(player);
    },
  );

  _initialized = true;
}

export function disposePlayerEcsBridge() {
  _unsubscribe?.();
  _unsubscribe = null;
  _initialized = false;
}

export function getPlayerEcsWorld() {
  _ensureInitialized();
  return _world;
}

export function getPlayerEntityId() {
  return PLAYER_ENTITY_ID;
}

export function ecsSetPlayerCurrentHp(current, options = {}) {
  _ensureInitialized();

  const health = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.HEALTH);
  if (!health) return 0;

  health.current = Math.max(0, Math.floor(current ?? 0));
  runHealthClampSystem(_world);
  _commitPlayer(options.source ?? "playerEcs:setCurrentHp");
  return health.current;
}

export function ecsSetPlayerTempHp(tempHp, options = {}) {
  _ensureInitialized();

  const health = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.HEALTH);
  if (!health) return 0;

  health.tempHp = Math.max(0, Math.floor(tempHp ?? 0));
  runHealthClampSystem(_world);
  _commitPlayer(options.source ?? "playerEcs:setTempHp");
  return health.tempHp;
}

export function ecsApplyDamageToPlayer(damage, options = {}) {
  _ensureInitialized();

  const result = applyDamageToEntity(_world, PLAYER_ENTITY_ID, damage, {
    useTempHp: options.useTempHp ?? true,
  });

  runHealthClampSystem(_world);
  _commitPlayer(options.source ?? "playerEcs:applyDamage");

  return result;
}

export function ecsHealPlayer(amount, options = {}) {
  _ensureInitialized();

  const result = healEntity(_world, PLAYER_ENTITY_ID, amount);
  runHealthClampSystem(_world);
  _commitPlayer(options.source ?? "playerEcs:heal");

  return result;
}

export function ecsGetPlayerInventory() {
  _ensureInitialized();

  const inventory = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.INVENTORY);
  return inventoryMapToArray(inventory?.items);
}

export function ecsSetPlayerInventory(inventoryList, options = {}) {
  _ensureInitialized();

  const inventory = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.INVENTORY);
  if (!inventory) return [];

  inventory.items = inventoryArrayToMap(inventoryList ?? []);
  _commitPlayer(options.source ?? "playerEcs:setInventory");
  return inventoryMapToArray(inventory.items);
}

export function ecsModifyPlayerGold(delta, options = {}) {
  _ensureInitialized();

  const inventory = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.INVENTORY);
  if (!inventory) return false;

  const nextGold = (inventory.gold ?? 0) + (delta ?? 0);
  if (nextGold < 0) return false;

  inventory.gold = nextGold;
  _commitPlayer(options.source ?? "playerEcs:modifyGold");
  return true;
}

export function ecsSetPlayerPosition(x, y, options = {}) {
  _ensureInitialized();

  const position = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.POSITION);
  if (!position) return null;

  position.x = Math.floor(x ?? position.x ?? 0);
  position.y = Math.floor(y ?? position.y ?? 0);

  if (options.commit !== false) {
    _commitPlayer(options.source ?? "playerEcs:setPosition");
  }

  return { x: position.x, y: position.y };
}

export function ecsSetPlayerMovementSpeed(speed, options = {}) {
  _ensureInitialized();

  const velocity = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.VELOCITY);
  if (!velocity) return 0;

  velocity.speed = Math.max(0, Math.floor(speed ?? velocity.speed ?? 0));
  _commitPlayer(options.source ?? "playerEcs:setMovementSpeed");
  return velocity.speed;
}

export function ecsSetPlayerKnockoutState(payload = {}, options = {}) {
  _ensureInitialized();

  const health = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.HEALTH);
  const attributes = _world.getComponent(
    PLAYER_ENTITY_ID,
    COMPONENTS.ATTRIBUTES,
  );
  if (!health || !attributes) return;

  health.current = Math.max(0, Math.floor(payload.hp ?? 0));
  health.deathSaveActive = payload.deathSaveActive ?? true;
  health.deathSaves = structuredClone(
    payload.deathSaves ?? { successes: 0, failures: 0 },
  );

  if (Array.isArray(payload.conditions)) {
    attributes.conditions = [...new Set(payload.conditions)];
  }

  runHealthClampSystem(_world);
  _commitPlayer(options.source ?? "playerEcs:setKnockoutState");
}

/**
 * Optional ECS-only movement tick for future keyboard-driven world navigation.
 */
export function ecsRunPlayerMovementTick(inputState, options = {}) {
  _ensureInitialized();

  runInputSystem(_world, inputState);
  runMovementSystem(_world, options);
  _commitPlayer(options.source ?? "playerEcs:movementTick");

  const position = _world.getComponent(PLAYER_ENTITY_ID, COMPONENTS.POSITION);
  return position ? { x: position.x, y: position.y } : null;
}
