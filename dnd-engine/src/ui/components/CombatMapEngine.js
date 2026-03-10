/**
 * CombatMapEngine.js
 *
 * Tactical grid map rendered on an HTML5 Canvas.
 * Automatically mounts on COMBAT_STARTED and tears down on COMBAT_ENDED.
 *
 * Coordinate system  : grid [col, row] → pixel [col * CELL, row * CELL]
 * Distance formula   : Chebyshev (D&D 5e diagonal = 1 square)
 * Movement cost      : 5 ft per square; movementRemaining is in feet
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";
import { moveParticipant, calcDistance } from "../../systems/turnManager.js";
import { performAttack } from "../../engine/actionDispatcher.js";
import { EQUIPMENT_TEMPLATES } from "../../data/equipment.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Logical pixels per grid square — matches store default cellSize. */
const CELL = 48;
const COLS = 20;
const ROWS = 14;
const CW = COLS * CELL; // canvas logical width  = 960
const CH = ROWS * CELL; // canvas logical height = 672

// Palette
const COL_GRID = "rgba(255,255,255,0.10)";
const COL_MOVE_FILL = "rgba(60,120,255,0.22)";
const COL_MOVE_BORDER = "rgba(80,150,255,0.70)";
const COL_ATK_FILL = "rgba(255,60,60,0.16)";
const COL_ATK_BORDER = "rgba(255,80,80,0.65)";
const COL_HOVER = "rgba(255,220,80,0.28)";
const COL_PLAYER_FILL = "#c8922a";
const COL_ENEMY_FILL = "#7a1a28";

// ── Module-level state ────────────────────────────────────────────────────────

/** @type {HTMLDivElement|null}    */ let _overlay = null;
/** @type {HTMLCanvasElement|null} */ let _canvas = null;
/** @type {CanvasRenderingContext2D|null} */ let _ctx = null;
/** @type {HTMLImageElement|null}  */ let _bgImage = null;
/** @type {number|null}            */ let _rafId = null;
/** @type {Function[]}             */ let _unsubs = [];

/** Currently hovered grid cell. @type {{ x:number, y:number }|null} */
let _hoveredCell = null;

/**
 * Info about the location where combat is taking place.
 * Resolved once at mount time from world.currentSceneId + campaign.locations.
 * @type {{ id:string|null, name:string, emoji:string, type:string }}
 */
let _locationInfo = {
  id: null,
  name: "",
  emoji: "⚔️",
  type: "dungeon_room",
  battlemap: null, // URL/path of the battle map image for this location
  obstacles: [], // [{ x, y, type }] from campaign.json
  sightRadius: 8, // Fog of War sight radius in grid squares
};

/**
 * "col,row" strings for every square the active player can move into.
 * @type {Set<string>}
 */
let _validMoves = new Set();

/**
 * IDs of enemies the active player can attack right now.
 * @type {Set<string>}
 */
let _attackable = new Set();

/** Obstacle map: "x,y" → type string ("wall"|"pillar"|"crate"|"rock"). */
let _obstacles = new Map();

/** Cells the player currently has line-of-sight to. Re-computed on each move. */
let _visibleCells = new Set();

/** All cells revealed at any point during this combat (never shrinks until unmount). */
let _exploredCells = new Set();

/** Sight radius in grid squares (loaded from location data, default 8). */
let _sightRadius = 8;

/**
 * Active ranged-projectile arc animation.
 * @type {{ fromX:number, fromY:number, toX:number, toY:number, startTime:number, duration:number }|null}
 */
let _rangedArcAnim = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register lifecycle listeners.
 * Call ONCE during bootstrap — the map mounts/unmounts automatically.
 */
export function initCombatMap() {
  eventBus.on(EVENTS.COMBAT_STARTED, _onCombatStarted);
  eventBus.on(EVENTS.COMBAT_ENDED, _onCombatEnded);
  console.log("[CombatMapEngine] Initialised.");
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function _onCombatStarted() {
  _mount();
}
function _onCombatEnded() {
  _unmount();
}

function _mount() {
  _unmount(); // idempotent safety

  // ── DOM ──────────────────────────────────────────────────────────────────
  _overlay = document.createElement("div");
  _overlay.id = "combat-map-overlay";

  _canvas = document.createElement("canvas");
  _canvas.id = "combat-map-canvas";
  _canvas.width = CW;
  _canvas.height = CH;

  _overlay.appendChild(_canvas);
  document.body.appendChild(_overlay);

  // Mark HUD so it adopts floating layout when the map is visible
  document
    .querySelector("#combat-hud")
    ?.classList.add("combat-hud--map-active");

  _ctx = _canvas.getContext("2d");

  // ── Resolve current location info (battlemap, obstacles, sight) ──────────
  {
    const state = gameStore.getState();
    const sceneId = state.world.currentSceneId;
    const loc = state.campaign.locations?.[sceneId];
    _locationInfo = {
      id: sceneId,
      name: loc?.name ?? "Unknown Location",
      emoji: loc?.emoji ?? "⚔️",
      type: loc?.type ?? "dungeon_room",
      battlemap: loc?.battlemap ?? null,
      obstacles: loc?.obstacles ?? [],
      sightRadius: loc?.sightRadius ?? 8,
    };

    // Encounter-specific mapType overrides the location's default terrain type
    const encounterMapType = gameStore.getState().combat?.map?.mapType;
    if (encounterMapType) _locationInfo.type = encounterMapType;
  }
  _sightRadius = _locationInfo.sightRadius;
  _buildObstacles(_locationInfo.obstacles);

  // ── Background image: location battlemap → combat.map override → procedural ──
  const bgSrc =
    _locationInfo.battlemap ??
    gameStore.getState().combat?.map?.backgroundImage ??
    null;
  if (bgSrc) {
    const img = new Image();
    img.onload = () => {
      _bgImage = img;
    };
    img.onerror = () => {
      _bgImage = null;
    }; // fall back to procedural terrain
    img.src = bgSrc;
  }

  // ── Interaction ───────────────────────────────────────────────────────────
  _canvas.addEventListener("mousemove", _onMouseMove);
  _canvas.addEventListener("click", _onCanvasClick);
  _canvas.addEventListener("mouseleave", _onMouseLeave);

  // ── State subscription ────────────────────────────────────────────────────
  _unsubs.push(
    gameStore.select(
      (s) => s.combat,
      () => _updateInteractionState(),
    ),
  );

  _updateInteractionState();

  // ── Fog of War: recompute visibility when player position changes ─────────
  _unsubs.push(
    gameStore.select(
      (s) => {
        const p = s.combat.turnOrder.find((e) => e.isPlayer);
        return p ? `${p.x},${p.y}` : null;
      },
      () => _recomputeVisibility(),
    ),
  );
  _recomputeVisibility();

  _rafId = requestAnimationFrame(_renderLoop);
}

function _unmount() {
  if (_rafId) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }

  if (_canvas) {
    _canvas.removeEventListener("mousemove", _onMouseMove);
    _canvas.removeEventListener("click", _onCanvasClick);
    _canvas.removeEventListener("mouseleave", _onMouseLeave);
  }

  _unsubs.forEach((fn) => fn());
  _unsubs = [];

  document
    .querySelector("#combat-hud")
    ?.classList.remove("combat-hud--map-active");

  // Fade out before removal
  if (_overlay) {
    _overlay.classList.add("combat-map-overlay--exit");
    const overlayRef = _overlay;
    setTimeout(() => overlayRef.remove(), 350);
  }

  _overlay = null;
  _canvas = null;
  _ctx = null;
  _bgImage = null;
  _hoveredCell = null;
  _validMoves = new Set();
  _attackable = new Set();
  _obstacles = new Map();
  _visibleCells = new Set();
  _exploredCells = new Set();
  _sightRadius = 8;
  _rangedArcAnim = null;
  _locationInfo = {
    id: null,
    name: "",
    emoji: "⚔️",
    type: "dungeon_room",
    battlemap: null,
    obstacles: [],
    sightRadius: 8,
  };
}

// ── Interaction state computation ─────────────────────────────────────────────

/**
 * Recompute which squares the player can move into and which enemies are
 * within attack range.  Called whenever the combat store slice changes.
 */
function _updateInteractionState() {
  const state = gameStore.getState();
  if (!state.combat.active) {
    _validMoves = new Set();
    _attackable = new Set();
    return;
  }

  const { turnOrder, currentTurnIndex } = state.combat;
  const current = turnOrder[currentTurnIndex];

  // Only compute when it the local player's turn
  if (!current?.isPlayer || !state.session.isMyTurn) {
    _validMoves = new Set();
    _attackable = new Set();
    return;
  }

  const squaresLeft = Math.floor((current.movementRemaining ?? 0) / 5);

  // Build occupied-cell set (living combatants)
  const occupiedCells = new Set(
    turnOrder.filter((p) => (p.hp ?? 1) > 0).map((p) => `${p.x},${p.y}`),
  );

  // Valid move squares: within movement budget, not occupied
  const moves = new Set();
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      if (occupiedCells.has(`${cx},${cy}`)) continue;
      if (_obstacles.has(`${cx},${cy}`)) continue; // blocked by obstacle
      if (calcDistance(current, { x: cx, y: cy }) <= squaresLeft) {
        moves.add(`${cx},${cy}`);
      }
    }
  }
  _validMoves = moves;

  // Attackable enemies: alive enemies within weapon range
  const range = _resolveWeaponRange(state);
  const atk = new Set();
  for (const p of turnOrder) {
    if (p.isPlayer || (p.hp ?? 1) <= 0) continue;
    if (calcDistance(current, p) <= range) atk.add(p.id);
  }
  _attackable = atk;
}

/**
 * Determine the player's effective weapon range in squares.
 * Checks the equipment system data first, then the participant's own weaponRange.
 *
 * @param {object} state
 * @returns {number} range in squares (1 = melee)
 */
function _resolveWeaponRange(state) {
  const { player, combat } = state;

  let rangeSquares = 1; // melee default

  const weaponSlot = player.equipment?.weapon;
  if (weaponSlot) {
    const tmpl = _safeEquipTemplate(weaponSlot.itemId);
    if (tmpl?.bonuses?.weaponRange) rangeSquares = tmpl.bonuses.weaponRange;
  }

  // The participant entry in turnOrder may carry a weaponRange override
  const playerInOrder = combat.turnOrder.find((p) => p.isPlayer);
  if ((playerInOrder?.weaponRange ?? 0) > rangeSquares) {
    rangeSquares = playerInOrder.weaponRange;
  }

  return rangeSquares;
}

function _safeEquipTemplate(itemId) {
  try {
    return EQUIPMENT_TEMPLATES?.[itemId] ?? null;
  } catch {
    return null;
  }
}

// ── Mouse / click handlers ────────────────────────────────────────────────────

function _cellFromEvent(e) {
  const rect = _canvas.getBoundingClientRect();
  const scaleX = CW / rect.width;
  const scaleY = CH / rect.height;
  return {
    x: Math.floor(((e.clientX - rect.left) * scaleX) / CELL),
    y: Math.floor(((e.clientY - rect.top) * scaleY) / CELL),
  };
}

function _onMouseMove(e) {
  const cell = _cellFromEvent(e);
  if (cell.x < 0 || cell.x >= COLS || cell.y < 0 || cell.y >= ROWS) {
    _hoveredCell = null;
    return;
  }
  _hoveredCell = cell;
}

function _onMouseLeave() {
  _hoveredCell = null;
}

async function _onCanvasClick(e) {
  const state = gameStore.getState();
  if (!state.combat.active || !state.session.isMyTurn) return;

  const { turnOrder, currentTurnIndex } = state.combat;
  const playerParticipant = turnOrder[currentTurnIndex];
  if (!playerParticipant?.isPlayer) return;

  const cell = _cellFromEvent(e);
  if (cell.x < 0 || cell.x >= COLS || cell.y < 0 || cell.y >= ROWS) return;

  // ── Check if an enemy token is at this cell ──────────────────────────────
  const enemyAtCell = turnOrder.find(
    (p) => !p.isPlayer && (p.hp ?? 1) > 0 && p.x === cell.x && p.y === cell.y,
  );

  if (enemyAtCell) {
    if (_attackable.has(enemyAtCell.id)) {
      await _executeMapAttack(state, playerParticipant, enemyAtCell.id);
    } else {
      // Visual "out of range" feedback
      const dist = calcDistance(playerParticipant, enemyAtCell);
      const range = _resolveWeaponRange(state);
      eventBus.emit(EVENTS.COMBAT_MAP_ATTACK_RANGE_INVALID, {
        targetId: enemyAtCell.id,
        distance: dist,
        range,
      });
      _flashCanvas();
    }
    return;
  }

  // ── Otherwise try movement ────────────────────────────────────────────────
  if (_validMoves.has(`${cell.x},${cell.y}`)) {
    moveParticipant(playerParticipant.id ?? "player", cell.x, cell.y);
  }
}

/**
 * Perform a melee/ranged attack originating from a map click.
 * Mirrors the attack-button logic in CombatUI so the same formulas apply.
 */
async function _executeMapAttack(state, playerParticipant, targetId) {
  const { player } = state;

  const weaponSlot = player.equipment?.weapon;
  const weaponTemplate = weaponSlot
    ? _safeEquipTemplate(weaponSlot.itemId)
    : null;
  const legacyEquipped = !weaponTemplate
    ? player.inventory.find((i) => i.equipped && i.type === "weapon")
    : null;

  const strMod = Math.floor((player.abilities.str - 10) / 2);
  const dexMod = Math.floor((player.abilities.dex - 10) / 2);
  const isFinesse =
    weaponTemplate?.bonuses?.finesse ?? legacyEquipped?.finesse ?? false;
  const isRanged =
    weaponTemplate?.bonuses?.ranged ?? legacyEquipped?.ranged ?? false;
  const isDexBased =
    weaponTemplate?.bonuses?.dexBased ?? legacyEquipped?.dexBased ?? false;

  // Ranged → DEX | Finesse → max(STR,DEX) | otherwise → STR
  const atkStatMod = isDexBased
    ? dexMod
    : isFinesse
      ? Math.max(strMod, dexMod)
      : strMod;
  const atkMod =
    atkStatMod + player.proficiencyBonus + (player.attackBonus ?? 0);

  const damageDie =
    weaponTemplate?.bonuses?.damageDie ?? (legacyEquipped ? 6 : 4);
  const dmgNote = legacyEquipped?.damageNotation ?? `1d${damageDie}`;
  const dmgBonus = isDexBased
    ? dexMod
    : isFinesse
      ? Math.max(strMod, dexMod)
      : strMod;
  const weaponName =
    weaponTemplate?.name ?? legacyEquipped?.name ?? "unarmed strike";

  // Adjacency disadvantage for ranged weapons (D&D 5e)
  let hasDisadvantage = false;
  if (isRanged) {
    const adjacentEnemy = state.combat.turnOrder.find(
      (p) =>
        !p.isPlayer &&
        (p.hp ?? 1) > 0 &&
        calcDistance(playerParticipant, p) <= 1,
    );
    if (adjacentEnemy) {
      hasDisadvantage = true;
    }
  }

  // Trigger ranged arc visual
  if (isRanged) {
    const targetParticipant = state.combat.turnOrder.find(
      (p) => p.id === targetId,
    );
    if (targetParticipant) {
      _rangedArcAnim = {
        fromX: playerParticipant.x,
        fromY: playerParticipant.y,
        toX: targetParticipant.x,
        toY: targetParticipant.y,
        startTime: Date.now(),
        duration: 600,
      };
    }
  }

  await performAttack(player.id ?? "player", targetId, {
    attackBonus: atkMod,
    damageNotation: `${dmgNote}+${dmgBonus}`,
    damageName: weaponName,
    disadvantage: hasDisadvantage,
  });
}

/** Brief red-border flash for out-of-range clicks. */
function _flashCanvas() {
  if (!_canvas) return;
  _canvas.classList.add("combat-map-canvas--oor");
  setTimeout(() => _canvas?.classList.remove("combat-map-canvas--oor"), 500);
}

// ── Render loop ───────────────────────────────────────────────────────────────

function _renderLoop() {
  if (!_ctx) return;
  _render();
  _rafId = requestAnimationFrame(_renderLoop);
}

function _render() {
  const ctx = _ctx;
  const state = gameStore.getState();
  const { turnOrder, currentTurnIndex } = state.combat;
  const t = Date.now() * 0.003; // seconds-ish, for animation uniforms

  // ── Layer 1: Background (real image or procedural terrain) ─────────────────
  if (_bgImage) {
    ctx.drawImage(_bgImage, 0, 0, CW, CH);
  } else {
    _drawTerrainBg(ctx, _locationInfo.type);
  }

  // ── Layer 2: Tile highlights (movement, attack range) ────────────────────
  _drawHighlights(ctx, state, turnOrder);

  // ── Layer 3: Grid ────────────────────────────────────────────────────────
  _drawGrid(ctx);

  // ── Layer 4: Obstacles ───────────────────────────────────────────────────
  _drawObstacles(ctx);

  // ── Layer 5: Hover cell (skip obstacle cells) ─────────────────────────────
  if (_hoveredCell && !_obstacles.has(`${_hoveredCell.x},${_hoveredCell.y}`)) {
    ctx.fillStyle = COL_HOVER;
    ctx.fillRect(_hoveredCell.x * CELL, _hoveredCell.y * CELL, CELL, CELL);
  }

  // ── Layer 6: Tokens (enemies hidden while outside FoW) ───────────────────
  const activeCombatant = turnOrder[currentTurnIndex];
  for (const p of turnOrder) {
    if ((p.hp ?? 1) <= 0) continue;
    if (!p.isPlayer && !_visibleCells.has(`${p.x},${p.y}`)) continue; // FoW
    _drawToken(ctx, p, p === activeCombatant, t);
  }

  // ── Layer 7: Ranged projectile arc ───────────────────────────────────────
  if (_rangedArcAnim) _drawRangedArc(ctx);

  // ── Layer 8: Fog of War overlay ──────────────────────────────────────────
  _drawFoW(ctx);

  // ── Layer 9: Location banner (always on top) ─────────────────────────────
  _drawLocationBanner(ctx);
}

// ── Draw helpers ──────────────────────────────────────────────────────────────

// ── Terrain background renderers ─────────────────────────────────────────────

/**
 * Dispatch to the correct terrain renderer based on location type.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} type
 */
function _drawTerrainBg(ctx, type) {
  switch (type) {
    case "safe_zone":
    case "cobblestone":
      return _drawCobbleBg(ctx);
    case "boss_room":
      return _drawBossRoomBg(ctx);
    case "forest":
      return _drawForestBg(ctx);
    case "grassland":
      return _drawGrasslandBg(ctx);
    case "road":
      return _drawRoadBg(ctx);
    case "sewer":
      return _drawSewerBg(ctx);
    case "dungeon_room":
    default:
      return _drawStoneDungeonBg(ctx);
  }
}

/** Dark stone dungeon — cracked flagstones, moss hints. */
function _drawStoneDungeonBg(ctx) {
  ctx.fillStyle = "#111217";
  ctx.fillRect(0, 0, CW, CH);

  // Stone tile per grid cell
  const seed = (cx, cy, n) =>
    Math.abs(Math.sin(cx * 374.3 + cy * 819.7 + n) * 65537) % 1;
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const v = 0.07 + seed(cx, cy, 1) * 0.09;
      ctx.fillStyle = `rgba(255,255,255,${v})`;
      ctx.fillRect(cx * CELL + 1, cy * CELL + 1, CELL - 2, CELL - 2);

      // Random mortar gap darkness
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(cx * CELL, cy * CELL, 1, CELL);
      ctx.fillRect(cx * CELL, cy * CELL, CELL, 1);

      // Occasional crack
      if (seed(cx, cy, 2) < 0.12) {
        ctx.save();
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        const x0 = cx * CELL + seed(cx, cy, 3) * CELL;
        const y0 = cy * CELL + seed(cx, cy, 4) * CELL;
        ctx.moveTo(x0, y0);
        ctx.lineTo(
          x0 + (seed(cx, cy, 5) - 0.5) * 18,
          y0 + (seed(cx, cy, 6) - 0.5) * 18,
        );
        ctx.stroke();
        ctx.restore();
      }
      // Occasional moss spot
      if (seed(cx, cy, 7) < 0.07) {
        ctx.fillStyle = "rgba(40,80,30,0.35)";
        const mx = cx * CELL + seed(cx, cy, 8) * (CELL - 8);
        const my = cy * CELL + seed(cx, cy, 9) * (CELL - 8);
        ctx.beginPath();
        ctx.ellipse(mx, my, 6, 4, seed(cx, cy, 10) * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  _applyVignette(ctx, "rgba(0,0,0,0.60)");
}

/** Ornate boss chamber — deep crimson/amber accents, heavier vignette. */
function _drawBossRoomBg(ctx) {
  ctx.fillStyle = "#0a0a0e";
  ctx.fillRect(0, 0, CW, CH);

  const seed = (cx, cy, n) =>
    Math.abs(Math.sin(cx * 213.7 + cy * 591.3 + n) * 65537) % 1;
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      // Slightly reddish stone
      const v = 0.06 + seed(cx, cy, 1) * 0.07;
      ctx.fillStyle = `rgba(120,30,30,${v})`;
      ctx.fillRect(cx * CELL + 1, cy * CELL + 1, CELL - 2, CELL - 2);

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(cx * CELL, cy * CELL, 1, CELL);
      ctx.fillRect(cx * CELL, cy * CELL, CELL, 1);

      // Decorative diamond inlay every 4 cells
      if ((cx + cy) % 4 === 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(180,100,30,0.18)";
        ctx.lineWidth = 1;
        const tx = cx * CELL + CELL / 2;
        const ty = cy * CELL + CELL / 2;
        const d = CELL * 0.38;
        ctx.beginPath();
        ctx.moveTo(tx, ty - d);
        ctx.lineTo(tx + d, ty);
        ctx.lineTo(tx, ty + d);
        ctx.lineTo(tx - d, ty);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  // Central ambient glow (altar / focus point)
  const glow = ctx.createRadialGradient(
    CW / 2,
    CH / 2,
    20,
    CW / 2,
    CH / 2,
    CW * 0.5,
  );
  glow.addColorStop(0, "rgba(160,40,10,0.18)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CW, CH);
  _applyVignette(ctx, "rgba(0,0,0,0.72)");
}

/** City cobblestone — lighter, warm-grey, rounded stones. */
function _drawCobbleBg(ctx) {
  ctx.fillStyle = "#2a2825";
  ctx.fillRect(0, 0, CW, CH);

  const seed = (cx, cy, n) =>
    Math.abs(Math.sin(cx * 455.1 + cy * 733.9 + n) * 65537) % 1;
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const v = 0.12 + seed(cx, cy, 1) * 0.12;
      ctx.fillStyle = `rgba(200,180,140,${v})`;
      // Rounded cobble shape
      const pad = 3;
      const r = 5;
      const x = cx * CELL + pad,
        y = cy * CELL + pad;
      const w = CELL - pad * 2,
        h = CELL - pad * 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fill();

      // Grout gap
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  _applyVignette(ctx, "rgba(0,0,0,0.45)");
}

/** Dark forest — packed dirt floor, tree trunks, dappled shadow. */
function _drawForestBg(ctx) {
  ctx.fillStyle = "#0e1a0a";
  ctx.fillRect(0, 0, CW, CH);

  const seed = (cx, cy, n) =>
    Math.abs(Math.sin(cx * 312.7 + cy * 711.3 + n) * 65537) % 1;

  // Mossy ground tiles
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const base = 0.04 + seed(cx, cy, 1) * 0.1;
      const hue = 95 + seed(cx, cy, 11) * 30;
      ctx.fillStyle = `hsla(${hue},40%,14%,${base + 0.08})`;
      ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);

      // Leaf / moss scatter
      if (seed(cx, cy, 2) < 0.25) {
        ctx.fillStyle = `rgba(40,90,20,${0.1 + seed(cx, cy, 12) * 0.15})`;
        const lx = cx * CELL + seed(cx, cy, 3) * (CELL - 10);
        const ly = cy * CELL + seed(cx, cy, 4) * (CELL - 10);
        ctx.beginPath();
        ctx.ellipse(
          lx,
          ly,
          7 + seed(cx, cy, 5) * 8,
          4 + seed(cx, cy, 6) * 5,
          seed(cx, cy, 7) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }

  // Tree trunks scattered about
  const trunkCount = 12;
  for (let i = 0; i < trunkCount; i++) {
    const tx = (seed(i, 0, 20) * (COLS - 1)) | 0;
    const ty = (seed(i, 0, 21) * (ROWS - 1)) | 0;
    const px = tx * CELL + CELL / 2;
    const py = ty * CELL + CELL / 2;
    const tr = 9 + seed(i, 0, 22) * 8;
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(px + 4, py + 5, tr + 3, tr * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // Bark
    ctx.fillStyle = `hsl(${28 + seed(i, 0, 23) * 10},42%,${16 + seed(i, 0, 24) * 8}%)`;
    ctx.beginPath();
    ctx.arc(px, py, tr, 0, Math.PI * 2);
    ctx.fill();
    // Highlight
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.arc(px - tr * 0.25, py - tr * 0.25, tr * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  _applyVignette(ctx, "rgba(0,0,0,0.70)");
}

/** Open grassland — warm tan/green ground, sparse dry-grass tufts. */
function _drawGrasslandBg(ctx) {
  ctx.fillStyle = "#1c2910";
  ctx.fillRect(0, 0, CW, CH);

  const seed = (cx, cy, n) =>
    Math.abs(Math.sin(cx * 401.1 + cy * 659.7 + n) * 65537) % 1;

  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const v = 0.05 + seed(cx, cy, 1) * 0.12;
      const hue = 80 + seed(cx, cy, 11) * 25;
      ctx.fillStyle = `hsla(${hue},50%,20%,${v + 0.12})`;
      ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);

      // Dirt patches
      if (seed(cx, cy, 2) < 0.18) {
        ctx.fillStyle = `rgba(140,110,60,${0.06 + seed(cx, cy, 3) * 0.1})`;
        const dx = cx * CELL + seed(cx, cy, 4) * (CELL - 12);
        const dy = cy * CELL + seed(cx, cy, 5) * (CELL - 12);
        ctx.beginPath();
        ctx.ellipse(
          dx,
          dy,
          10 + seed(cx, cy, 6) * 8,
          6 + seed(cx, cy, 7) * 5,
          seed(cx, cy, 8) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }

      // Grass tufts (2-3 strokes)
      if (seed(cx, cy, 9) < 0.4) {
        ctx.save();
        ctx.strokeStyle = `rgba(${(100 + seed(cx, cy, 12) * 60) | 0},${(140 + seed(cx, cy, 13) * 60) | 0},30,0.55)`;
        ctx.lineWidth = 1;
        const bx = cx * CELL + seed(cx, cy, 10) * (CELL - 6);
        const by = cy * CELL + seed(cx, cy, 11) * (CELL - 6) + 4;
        for (let b = 0; b < 3; b++) {
          ctx.beginPath();
          ctx.moveTo(bx + b * 3, by);
          ctx.quadraticCurveTo(
            bx + b * 3 + (seed(cx, cy, 14 + b) - 0.5) * 6,
            by - 8 - seed(cx, cy, 17 + b) * 6,
            bx + b * 3 + (seed(cx, cy, 20 + b) - 0.5) * 8,
            by - 14 - seed(cx, cy, 23 + b) * 5,
          );
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
  _applyVignette(ctx, "rgba(0,0,0,0.45)");
}

/** Dirt road — gravel centre strip, wheel ruts, earthy sides. */
function _drawRoadBg(ctx) {
  ctx.fillStyle = "#261d10";
  ctx.fillRect(0, 0, CW, CH);

  const seed = (cx, cy, n) =>
    Math.abs(Math.sin(cx * 523.3 + cy * 347.1 + n) * 65537) % 1;
  const roadL = 7; // left edge column of road
  const roadR = 13; // right edge column of road

  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const onRoad = cx >= roadL && cx < roadR;
      // Ground tone
      const v = 0.06 + seed(cx, cy, 1) * 0.1;
      if (onRoad) {
        ctx.fillStyle = `rgba(180,145,90,${v + 0.18})`;
      } else {
        const hue = 85 + seed(cx, cy, 11) * 20;
        ctx.fillStyle = `hsla(${hue},35%,18%,${v + 0.12})`;
      }
      ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);

      if (onRoad && seed(cx, cy, 2) < 0.35) {
        // Gravel pebble
        ctx.fillStyle = `rgba(200,170,110,${0.08 + seed(cx, cy, 3) * 0.1})`;
        const gx = cx * CELL + seed(cx, cy, 4) * (CELL - 4);
        const gy = cy * CELL + seed(cx, cy, 5) * (CELL - 4);
        ctx.beginPath();
        ctx.arc(gx, gy, 1.5 + seed(cx, cy, 6) * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Wheel ruts (two vertical lanes)
  ctx.save();
  ctx.strokeStyle = "rgba(80,55,25,0.55)";
  ctx.lineWidth = 3;
  const rutOffsets = [roadL * CELL + CELL * 1.5, roadL * CELL + CELL * 4.5];
  for (const rx of rutOffsets) {
    ctx.beginPath();
    ctx.moveTo(rx, 0);
    ctx.lineTo(rx, CH);
    ctx.stroke();
  }
  ctx.restore();

  // Grass edges — scatter tufts on non-road cells
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < roadL; cx++) {
      if (seed(cx, cy, 30) < 0.3) {
        ctx.save();
        ctx.strokeStyle = `rgba(80,130,30,0.45)`;
        ctx.lineWidth = 1;
        const bx = cx * CELL + seed(cx, cy, 31) * (CELL - 4);
        const by = cy * CELL + seed(cx, cy, 32) * (CELL - 4) + 4;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + (seed(cx, cy, 33) - 0.5) * 8, by - 10);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (let cx = roadR; cx < COLS; cx++) {
      if (seed(cx, cy, 30) < 0.3) {
        ctx.save();
        ctx.strokeStyle = `rgba(80,130,30,0.45)`;
        ctx.lineWidth = 1;
        const bx = cx * CELL + seed(cx, cy, 31) * (CELL - 4);
        const by = cy * CELL + seed(cx, cy, 32) * (CELL - 4) + 4;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + (seed(cx, cy, 33) - 0.5) * 8, by - 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  _applyVignette(ctx, "rgba(0,0,0,0.50)");
}

/** Underground sewer — wet dark stone, murky central channel, green-black slime. */
function _drawSewerBg(ctx) {
  ctx.fillStyle = "#090d0a";
  ctx.fillRect(0, 0, CW, CH);

  const seed = (cx, cy, n) =>
    Math.abs(Math.sin(cx * 288.9 + cy * 934.1 + n) * 65537) % 1;
  const channelL = 8;
  const channelR = 12;

  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const inChannel = cx >= channelL && cx < channelR;
      const v = 0.04 + seed(cx, cy, 1) * 0.07;
      if (inChannel) {
        // Dark greenish water
        ctx.fillStyle = `rgba(15,40,18,${v + 0.3})`;
      } else {
        ctx.fillStyle = `rgba(255,255,255,${v})`;
      }
      ctx.fillRect(cx * CELL + 1, cy * CELL + 1, CELL - 2, CELL - 2);

      // Mortar
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(cx * CELL, cy * CELL, 1, CELL);
      ctx.fillRect(cx * CELL, cy * CELL, CELL, 1);

      if (!inChannel) {
        // Slime drip
        if (seed(cx, cy, 3) < 0.08) {
          ctx.fillStyle = `rgba(30,80,20,0.45)`;
          const sx = cx * CELL + seed(cx, cy, 4) * (CELL - 4);
          ctx.fillRect(sx, cy * CELL, 2, CELL * (0.3 + seed(cx, cy, 5) * 0.5));
        }
        // Moisture sheen
        if (seed(cx, cy, 6) < 0.12) {
          ctx.fillStyle = `rgba(80,160,100,0.07)`;
          ctx.fillRect(cx * CELL + 2, cy * CELL + 2, CELL - 4, CELL - 4);
        }
      } else {
        // Water ripple hint
        if (seed(cx, cy, 7) < 0.2) {
          ctx.strokeStyle = "rgba(40,120,50,0.20)";
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          const wx = cx * CELL + seed(cx, cy, 8) * (CELL - 6);
          const wy = cy * CELL + seed(cx, cy, 9) * (CELL - 6);
          ctx.arc(wx, wy, 3 + seed(cx, cy, 10) * 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  // Channel edge lines
  ctx.save();
  ctx.strokeStyle = "rgba(40,90,40,0.40)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(channelL * CELL, 0);
  ctx.lineTo(channelL * CELL, CH);
  ctx.moveTo(channelR * CELL, 0);
  ctx.lineTo(channelR * CELL, CH);
  ctx.stroke();
  ctx.restore();

  _applyVignette(ctx, "rgba(0,0,0,0.72)");
}

/**
 * Animate a ranged projectile arc from attacker to target.
 * Clears itself when the animation completes.
 */
function _drawRangedArc(ctx) {
  if (!_rangedArcAnim) return;
  const { fromX, fromY, toX, toY, startTime, duration } = _rangedArcAnim;
  const elapsed = Date.now() - startTime;
  const progress = Math.min(elapsed / duration, 1);

  if (progress >= 1) {
    _rangedArcAnim = null;
    return;
  }

  // Convert grid coords to canvas pixels (centre of cell)
  const x0 = fromX * CELL + CELL / 2;
  const y0 = fromY * CELL + CELL / 2;
  const x1 = toX * CELL + CELL / 2;
  const y1 = toY * CELL + CELL / 2;

  // Mid-point arc (parabolic loft)
  const midX = (x0 + x1) / 2;
  const midY = Math.min(y0, y1) - 40;

  // Current position along Bezier
  const t = progress;
  const bx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * midX + t * t * x1;
  const by = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * midY + t * t * y1;

  // Fade out near end
  const alpha = progress < 0.8 ? 1 : 1 - (progress - 0.8) / 0.2;

  ctx.save();
  // Trail
  ctx.globalAlpha = alpha * 0.55;
  const trailSteps = 6;
  for (let i = 0; i < trailSteps; i++) {
    const tp = Math.max(0, t - i * 0.04);
    const tbx =
      (1 - tp) * (1 - tp) * x0 + 2 * (1 - tp) * tp * midX + tp * tp * x1;
    const tby =
      (1 - tp) * (1 - tp) * y0 + 2 * (1 - tp) * tp * midY + tp * tp * y1;
    const r = 4 - i * 0.5;
    if (r <= 0) break;
    ctx.fillStyle = `rgba(255,220,80,${alpha * (1 - i / trailSteps)})`;
    ctx.beginPath();
    ctx.arc(tbx, tby, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Projectile dot
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(255,255,180,0.95)";
  ctx.shadowColor = "rgba(255,200,50,0.9)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(bx, by, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Shared radial vignette overlay. */
function _applyVignette(ctx, outerColour) {
  const vg = ctx.createRadialGradient(
    CW / 2,
    CH / 2,
    CW * 0.08,
    CW / 2,
    CH / 2,
    CW * 0.72,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, outerColour);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, CW, CH);
}

/** Location name banner in the top-left corner of the canvas. */
function _drawLocationBanner(ctx) {
  if (!_locationInfo.name) return;
  const text = `${_locationInfo.emoji}  ${_locationInfo.name}`;
  const fontSize = 13;
  ctx.save();
  ctx.font = `500 ${fontSize}px system-ui, sans-serif`;
  const textW = ctx.measureText(text).width;
  const padX = 10,
    padY = 6;
  const bx = 8,
    by = 8;
  const bw = textW + padX * 2,
    bh = fontSize + padY * 2;
  // Pill background
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 6);
  ctx.fill();
  // Border
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  // Text
  ctx.fillStyle = "rgba(220,200,160,0.92)";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, bx + padX, by + bh / 2);
  ctx.restore();
}

// ── Obstacle system ───────────────────────────────────────────────────────────────

function _buildObstacles(obstacleList) {
  _obstacles = new Map();
  for (const o of obstacleList ?? []) {
    _obstacles.set(`${o.x},${o.y}`, o.type ?? "wall");
  }
}

function _drawObstacles(ctx) {
  for (const [key, type] of _obstacles) {
    const [cx, cy] = key.split(",").map(Number);
    _drawObstacleTile(ctx, cx, cy, type);
  }
}

function _drawObstacleTile(ctx, cx, cy, type) {
  const px = cx * CELL,
    py = cy * CELL;
  ctx.save();
  switch (type) {
    case "wall": {
      ctx.fillStyle = "#16161c";
      ctx.fillRect(px, py, CELL, CELL);
      // Stone block face
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      // Diagonal cross = impassable marker
      ctx.strokeStyle = "rgba(90,90,110,0.45)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 2, py + 2);
      ctx.lineTo(px + CELL - 2, py + CELL - 2);
      ctx.moveTo(px + CELL - 2, py + 2);
      ctx.lineTo(px + 2, py + CELL - 2);
      ctx.stroke();
      break;
    }
    case "pillar": {
      ctx.fillStyle = "#16161c";
      ctx.fillRect(px, py, CELL, CELL);
      const pcx = px + CELL / 2,
        pcy = py + CELL / 2;
      const pr = CELL * 0.38;
      ctx.fillStyle = "#28283a";
      ctx.beginPath();
      ctx.arc(pcx, pcy, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(180,160,120,0.40)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pcx, pcy, pr, 0, Math.PI * 2);
      ctx.stroke();
      // Highlight cap
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.beginPath();
      ctx.arc(pcx - pr * 0.22, pcy - pr * 0.22, pr * 0.38, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "crate": {
      const pad = 4;
      ctx.fillStyle = "#3a2c18";
      ctx.fillRect(px + pad, py + pad, CELL - pad * 2, CELL - pad * 2);
      ctx.strokeStyle = "#6b4c2a";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px + pad, py + pad, CELL - pad * 2, CELL - pad * 2);
      // Plank lines
      ctx.strokeStyle = "rgba(80,55,25,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + pad, py + CELL / 2);
      ctx.lineTo(px + CELL - pad, py + CELL / 2);
      ctx.moveTo(px + CELL / 2, py + pad);
      ctx.lineTo(px + CELL / 2, py + CELL - pad);
      ctx.stroke();
      break;
    }
    case "rock":
    default: {
      ctx.fillStyle = "#1a1a20";
      ctx.fillRect(px, py, CELL, CELL);
      const seed = (n) =>
        Math.abs(Math.sin(cx * 374.3 + cy * 819.7 + n) * 65537) % 1;
      const rw = CELL * (0.52 + seed(1) * 0.26);
      const rh = CELL * (0.42 + seed(2) * 0.22);
      const rx = px + (CELL - rw) / 2 + (seed(3) - 0.5) * 5;
      const ry = py + (CELL - rh) / 2 + (seed(4) - 0.5) * 5;
      ctx.fillStyle = "#333340";
      ctx.beginPath();
      ctx.ellipse(
        rx + rw / 2,
        ry + rh / 2,
        rw / 2,
        rh / 2,
        seed(5) * 0.9,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = "rgba(75,75,95,0.50)";
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

// ── Fog of War system ─────────────────────────────────────────────────────────────────

/**
 * Recompute which cells the player can currently see.
 * Called once on mount and again on every player position change.
 */
function _recomputeVisibility() {
  const state = gameStore.getState();
  if (!state.combat.active) return;
  const player = state.combat.turnOrder.find((p) => p.isPlayer);
  if (!player) return;

  const newVisible = new Set();
  const px = player.x,
    py = player.y;

  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      // Chebyshev distance — same as D&D diagonal rule
      const dist = Math.max(Math.abs(cx - px), Math.abs(cy - py));
      if (dist <= _sightRadius && _hasLOS(px, py, cx, cy)) {
        newVisible.add(`${cx},${cy}`);
      }
    }
  }

  _visibleCells = newVisible;
  // Explored cells union — once seen, always remembered
  for (const key of newVisible) _exploredCells.add(key);
}

/**
 * Bresenham line walk: returns true when no obstacle blocks the path from
 * (x0,y0) to (x1,y1).  The player's starting cell is never a blocker.
 */
function _hasLOS(x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0,
    y = y0;
  while (true) {
    if (x === x1 && y === y1) return true;
    if (!(x === x0 && y === y0) && _obstacles.has(`${x},${y}`)) return false;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Draw the Fog of War overlay.
 * Unexplored cells → near-black, explored but dark cells → semi-transparent.
 */
function _drawFoW(ctx) {
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const key = `${cx},${cy}`;
      if (_visibleCells.has(key)) continue; // fully lit — no overlay
      ctx.fillStyle = _exploredCells.has(key)
        ? "rgba(0,0,0,0.62)" // explored but currently dark
        : "rgba(0,0,0,0.94)"; // never seen — near black
      ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
    }
  }
}

function _drawGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = COL_GRID;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let c = 0; c <= COLS; c++) {
    ctx.moveTo(c * CELL, 0);
    ctx.lineTo(c * CELL, CH);
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.moveTo(0, r * CELL);
    ctx.lineTo(CW, r * CELL);
  }
  ctx.stroke();
  ctx.restore();
}

function _drawHighlights(ctx, state, turnOrder) {
  const current = turnOrder[state.combat.currentTurnIndex];
  if (!current?.isPlayer || !state.session.isMyTurn) return;

  // ── Movement squares (blue) ──────────────────────────────────────────────
  ctx.save();
  ctx.fillStyle = COL_MOVE_FILL;
  ctx.strokeStyle = COL_MOVE_BORDER;
  ctx.lineWidth = 1;
  for (const key of _validMoves) {
    const [cx, cy] = key.split(",").map(Number);
    ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
    ctx.strokeRect(cx * CELL + 0.5, cy * CELL + 0.5, CELL - 1, CELL - 1);
  }
  ctx.restore();

  // ── Attack range cells (red, only on enemy tokens) ───────────────────────
  ctx.save();
  for (const p of turnOrder) {
    if (!_attackable.has(p.id)) continue;
    ctx.fillStyle = COL_ATK_FILL;
    ctx.strokeStyle = COL_ATK_BORDER;
    ctx.lineWidth = 1.5;
    ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL);
    ctx.strokeRect(p.x * CELL + 0.5, p.y * CELL + 0.5, CELL - 1, CELL - 1);
  }
  ctx.restore();
}

function _drawToken(ctx, p, isActive, t) {
  const cx = p.x * CELL + CELL / 2;
  const cy = p.y * CELL + CELL / 2;
  const r = CELL * 0.37;

  ctx.save();

  // ── Active-turn pulsing ring ─────────────────────────────────────────────
  if (isActive) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    ctx.shadowBlur = 10;
    ctx.shadowColor = "rgba(255,255,255,0.5)";
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.55 * pulse})`;
    ctx.lineWidth = 2.5 + pulse * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6 + pulse * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ── Attackable dashed ring ──────────────────────────────────────────────
  if (_attackable.has(p.id)) {
    ctx.strokeStyle = "rgba(255,80,80,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Token circle ─────────────────────────────────────────────────────────
  ctx.shadowBlur = 8;
  ctx.shadowColor = "rgba(0,0,0,0.8)";

  ctx.fillStyle = p.isPlayer ? COL_PLAYER_FILL : COL_ENEMY_FILL;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = p.isPlayer ? "#f0c860" : "#df4040";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();

  // ── Initial letter ────────────────────────────────────────────────────────
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(CELL * 0.4)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((p.name ?? "?")[0].toUpperCase(), cx, cy);

  // ── HP arc (ring around token) ────────────────────────────────────────────
  _drawHpArc(ctx, p, cx, cy, r);

  // ── Name label ────────────────────────────────────────────────────────────
  const label = p.name.length > 9 ? p.name.slice(0, 8) + "…" : p.name;
  ctx.fillStyle = p.isPlayer ? "#f0c860" : "#e08080";
  ctx.font = `${Math.round(CELL * 0.22)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // Place below the token circle
  ctx.fillText(label, cx, (p.y + 1) * CELL - Math.round(CELL * 0.28));

  // ── Movement remaining (player, active turn only) ─────────────────────────
  if (p.isPlayer && isActive && (p.movementRemaining ?? 0) > 0) {
    ctx.fillStyle = "rgba(100,170,255,0.95)";
    ctx.font = `bold ${Math.round(CELL * 0.21)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(
      `${p.movementRemaining}ft`,
      cx,
      p.y * CELL + Math.round(CELL * 0.22),
    );
  }
}

function _drawHpArc(ctx, p, cx, cy, r) {
  const maxHp = p.maxHp ?? p.hp ?? 1;
  const pct = Math.max(0, Math.min(1, (p.hp ?? 0) / maxHp));
  const arcR = r + 7;
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + Math.PI * 2 * pct;
  const colour = pct > 0.6 ? "#2e7d47" : pct > 0.25 ? "#b8902a" : "#9b2335";

  // Background track
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, 0, Math.PI * 2);
  ctx.stroke();

  // HP fill
  if (pct > 0) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, startAngle, endAngle);
    ctx.stroke();
  }
  ctx.restore();
}
