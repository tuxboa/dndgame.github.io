export const COMPONENTS = Object.freeze({
  IDENTITY: "identity",
  ATTRIBUTES: "attributes",
  HEALTH: "health",
  INVENTORY: "inventory",
  EQUIPMENT: "equipment",
  MAGIC: "magic",
  PROGRESSION: "progression",
  POSITION: "position",
  VELOCITY: "velocity",
  RENDERABLE: "renderable",
  PLAYER_CONTROLLED: "playerControlled",
});

export const PLAYER_ENTITY_ID = "player_entity";

export function inventoryArrayToMap(inventory = []) {
  const map = new Map();

  inventory.forEach((item) => {
    const key = item.itemId;
    if (!key) return;

    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...item,
        quantity: Math.max(0, item.quantity ?? 1),
      });
      return;
    }

    map.set(key, {
      ...prev,
      ...item,
      quantity: (prev.quantity ?? 0) + (item.quantity ?? 1),
    });
  });

  return map;
}

export function inventoryMapToArray(itemsMap) {
  if (!(itemsMap instanceof Map)) return [];
  return [...itemsMap.values()].map((item) => ({ ...item }));
}

export function createIdentityComponent(player = {}) {
  return {
    id: player.id ?? "player",
    name: player.name ?? "",
    class: player.class ?? "",
    race: player.race ?? "",
    level: player.level ?? 1,
  };
}

export function createAttributesComponent(player = {}) {
  return {
    ac: player.ac ?? 10,
    attackBonus: player.attackBonus ?? 0,
    proficiencyBonus: player.proficiencyBonus ?? 2,
    abilities: structuredClone(
      player.abilities ?? {
        str: 10,
        dex: 10,
        con: 10,
        int: 10,
        wis: 10,
        cha: 10,
      },
    ),
    skills: structuredClone(player.skills ?? {}),
    conditions: [...(player.conditions ?? [])],
    concentration:
      player.concentration != null
        ? structuredClone(player.concentration)
        : null,
    dodging: player.dodging ?? false,
  };
}

export function createHealthComponent(player = {}) {
  return {
    current: player.hp ?? 0,
    max: player.maxHp ?? 0,
    tempHp: player.tempHp ?? 0,
    baseMaxHp: player.baseMaxHp ?? null,
    deathSaves: structuredClone(
      player.deathSaves ?? { successes: 0, failures: 0 },
    ),
    deathSaveActive: player.deathSaveActive ?? false,
  };
}

export function createInventoryComponent(player = {}) {
  return {
    items: inventoryArrayToMap(player.inventory ?? []),
    gold: player.gold ?? 0,
  };
}

export function createEquipmentComponent(player = {}) {
  return {
    equipment: structuredClone(
      player.equipment ?? {
        weapon: null,
        armor: null,
        accessory: null,
        offhand: null,
      },
    ),
    baseAc: player.baseAc ?? null,
  };
}

export function createMagicComponent(player = {}) {
  return {
    mana: player.mana ?? 0,
    maxMana: player.maxMana ?? 0,
    baseMaxMana: player.baseMaxMana ?? null,
    spellSlots: structuredClone(player.spellSlots ?? {}),
    knownSpells: [...(player.knownSpells ?? [])],
    classAbilities: structuredClone(player.classAbilities ?? {}),
  };
}

export function createProgressionComponent(player = {}) {
  return {
    xp: player.xp ?? 0,
    feats: [...(player.feats ?? [])],
    luckPoints: player.luckPoints ?? 0,
  };
}

export function createPositionComponent(player = {}) {
  return {
    x: player.x ?? 0,
    y: player.y ?? 0,
  };
}

export function createVelocityComponent(player = {}) {
  return {
    dx: 0,
    dy: 0,
    speed: player.movementSpeed ?? player.speed ?? 5,
  };
}

export function createRenderableComponent(player = {}) {
  return {
    sprite: player.sprite ?? null,
    layer: player.layer ?? 1,
  };
}

export function createPlayerControlledComponent() {
  return { active: true };
}
