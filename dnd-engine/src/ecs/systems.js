import { COMPONENTS } from "./components.js";

function _isPressed(inputState, key) {
  if (!inputState) return false;
  if (typeof inputState.isDown === "function") return !!inputState.isDown(key);
  return !!inputState[key];
}

/**
 * Reads directional input and writes velocity on player-controlled entities.
 */
export function runInputSystem(world, inputState) {
  const entities = world.getEntitiesWith([
    COMPONENTS.PLAYER_CONTROLLED,
    COMPONENTS.VELOCITY,
  ]);

  entities.forEach((entityId) => {
    const velocity = world.getComponent(entityId, COMPONENTS.VELOCITY);
    if (!velocity) return;

    const speed = velocity.speed ?? 5;
    let dx = 0;
    let dy = 0;

    if (_isPressed(inputState, "ArrowUp") || _isPressed(inputState, "up"))
      dy -= speed;
    if (_isPressed(inputState, "ArrowDown") || _isPressed(inputState, "down"))
      dy += speed;
    if (_isPressed(inputState, "ArrowLeft") || _isPressed(inputState, "left"))
      dx -= speed;
    if (_isPressed(inputState, "ArrowRight") || _isPressed(inputState, "right"))
      dx += speed;

    velocity.dx = dx;
    velocity.dy = dy;
  });
}

/**
 * Applies velocity to position, then clears velocity.
 */
export function runMovementSystem(world, options = {}) {
  const entities = world.getEntitiesWith([
    COMPONENTS.POSITION,
    COMPONENTS.VELOCITY,
  ]);

  const bounds = options.bounds ?? null;

  entities.forEach((entityId) => {
    const position = world.getComponent(entityId, COMPONENTS.POSITION);
    const velocity = world.getComponent(entityId, COMPONENTS.VELOCITY);
    if (!position || !velocity) return;

    position.x += velocity.dx ?? 0;
    position.y += velocity.dy ?? 0;

    if (bounds) {
      position.x = Math.max(bounds.minX ?? position.x, position.x);
      position.x = Math.min(bounds.maxX ?? position.x, position.x);
      position.y = Math.max(bounds.minY ?? position.y, position.y);
      position.y = Math.min(bounds.maxY ?? position.y, position.y);
    }

    velocity.dx = 0;
    velocity.dy = 0;
  });
}

/**
 * Keeps health values in legal ranges.
 */
export function runHealthClampSystem(world) {
  const entities = world.getEntitiesWith([COMPONENTS.HEALTH]);

  entities.forEach((entityId) => {
    const health = world.getComponent(entityId, COMPONENTS.HEALTH);
    if (!health) return;

    const max = Math.max(0, health.max ?? 0);
    health.max = max;
    health.current = Math.max(0, Math.min(max, health.current ?? 0));
    health.tempHp = Math.max(0, health.tempHp ?? 0);

    const saves = health.deathSaves ?? { successes: 0, failures: 0 };
    health.deathSaves = {
      successes: Math.max(0, Math.min(3, saves.successes ?? 0)),
      failures: Math.max(0, Math.min(3, saves.failures ?? 0)),
    };
  });
}

/**
 * Applies incoming damage with optional temp-HP absorption.
 */
export function applyDamageToEntity(
  world,
  entityId,
  damage,
  options = { useTempHp: true },
) {
  const health = world.getComponent(entityId, COMPONENTS.HEALTH);
  if (!health) {
    return {
      appliedDamage: 0,
      absorbedTempHp: 0,
      previousHp: 0,
      newCurrentHp: 0,
      remainingTempHp: 0,
    };
  }

  let remaining = Math.max(0, Math.floor(damage ?? 0));
  let absorbedTempHp = 0;

  if (options.useTempHp && (health.tempHp ?? 0) > 0 && remaining > 0) {
    absorbedTempHp = Math.min(health.tempHp, remaining);
    health.tempHp -= absorbedTempHp;
    remaining -= absorbedTempHp;
  }

  const previousHp = health.current ?? 0;
  health.current = Math.max(0, previousHp - remaining);

  return {
    appliedDamage: remaining,
    absorbedTempHp,
    previousHp,
    newCurrentHp: health.current,
    remainingTempHp: health.tempHp ?? 0,
  };
}

/**
 * Heals up to max HP.
 */
export function healEntity(world, entityId, amount) {
  const health = world.getComponent(entityId, COMPONENTS.HEALTH);
  if (!health) {
    return {
      healed: 0,
      previousHp: 0,
      newCurrentHp: 0,
    };
  }

  const previousHp = health.current ?? 0;
  const max = Math.max(0, health.max ?? previousHp);
  health.current = Math.min(max, previousHp + Math.max(0, amount ?? 0));

  return {
    healed: health.current - previousHp,
    previousHp,
    newCurrentHp: health.current,
  };
}
