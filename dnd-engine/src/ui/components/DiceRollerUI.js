/**
 * DiceRollerUI.js
 *
 * CSS-animated dice system — no three.js dependency.
 * Dice tumble in from the bottom, settle on the correct face, then fade out.
 * Results are always determined by diceSystem.js (crypto RNG); animation is cosmetic.
 *
 * Public API:
 *   initDiceUI()                          - mount overlay DOM, wire event bus
 *   animate(notation, result)             - fire-and-forget animation (enemy rolls)
 *   promptRollAndAnimate(notation, label) - paused player roll, resolves with RollResult
 *   showToast(notation, result)           - always-visible result card
 */

import { eventBus, EVENTS } from "../../engine/eventBus.js";
import { roll } from "../../systems/diceSystem.js";

// Serialise concurrent animations so they queue, not race.
let _animQueue = Promise.resolve();
let _ready = false;

// == Init =====================================================================

export function initDiceUI() {
  _injectStyles();
  _ready = true;
  console.log("[DiceUI] CSS dice roller ready.");

  eventBus.on(EVENTS.DICE_ANIMATE, ({ notation, result }) => {
    animate(notation, result).catch(() => {});
  });
}

// == Public animate API =======================================================

export function animate(notation, result) {
  _animQueue = _animQueue
    .then(() => _animateOnce(notation, result))
    .catch(() => {});
  return _animQueue;
}

function _animateOnce(notation, result) {
  return new Promise((resolve) => {
    const sides   = _parseSides(notation);
    const allDice = result.dice ?? result.used;
    const finalVal = allDice[0] ?? result.total;

    const overlay = _showDimOverlay();
    const dieEl   = _buildDie(sides, finalVal);

    // Position randomly in the centre third of the screen
    const MARGIN = 0.2;
    const left = MARGIN + Math.random() * (1 - 2 * MARGIN);
    const top  = MARGIN + Math.random() * (1 - 2 * MARGIN);
    dieEl.style.left = `${(left * 100).toFixed(1)}%`;
    dieEl.style.top  = `${(top  * 100).toFixed(1)}%`;

    document.body.appendChild(dieEl);

    const TUMBLE_MS = 700;
    const HOLD_MS   = 900;
    const FADE_MS   = 400;

    // 1. Snap to settled glow
    setTimeout(() => dieEl.classList.add("dice-settled"), TUMBLE_MS);
    // 2. Show toast while die is on screen
    setTimeout(() => showToast(notation, result), TUMBLE_MS + 200);
    // 3. Fade out
    setTimeout(() => dieEl.classList.add("dice-fadeout"), TUMBLE_MS + HOLD_MS);
    // 4. Clean up and resolve
    setTimeout(() => {
      dieEl.remove();
      _hideDimOverlay();
      resolve();
    }, TUMBLE_MS + HOLD_MS + FADE_MS);
  });
}

// == Player prompt (pauses game until clicked) ================================

export function promptRollAndAnimate(notation, label = "Roll Dice") {
  return new Promise((resolve) => {
    let card = document.getElementById("dice-roll-card");
    if (!card) {
      card = document.createElement("div");
      card.id = "dice-roll-card";
      document.body.appendChild(card);
    }

    card.innerHTML = `
      <div class="roll-prompt">
        <p class="roll-prompt-label">${label}</p>
        <p class="roll-prompt-notation">${notation}</p>
        <button class="roll-prompt-btn" id="roll-prompt-go">Roll!</button>
      </div>
    `;
    card.classList.add("visible");

    document.getElementById("roll-prompt-go").addEventListener(
      "click",
      async () => {
        card.classList.remove("visible");
        const result = roll(notation);
        await animate(notation, result);
        resolve(result);
      },
      { once: true },
    );
  });
}

// == Toast ====================================================================

export function showToast(notation, result) {
  let toast = document.querySelector("#dice-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "dice-toast";
    document.body.appendChild(toast);
  }

  const modStr =
    result.modifier > 0
      ? ` +${result.modifier}`
      : result.modifier < 0
        ? ` ${result.modifier}`
        : "";

  const allUsed = result.used ?? result.dice ?? [];
  const isD20Roll =
    (result.dice?.length === 1 || result.used?.length === 1) &&
    notation.includes("d20");
  const isCrit   = result.critical === true || (isD20Roll && (result.dice ?? result.used)?.[0] === 20);
  const isFumble = isD20Roll && (result.dice ?? result.used)?.[0] === 1;

  toast.innerHTML = `
    <span class="dice-toast-notation">${notation}</span>
    <span class="dice-toast-dice">[${allUsed.join(", ")}${
      result.dropped?.length ? ` <s>${result.dropped.join(", ")}</s>` : ""
    }]${modStr}</span>
    <span class="dice-toast-total">${result.total}</span>
    ${isCrit ? '<span class="dice-toast-crit">CRIT!</span>' : ""}
  `;

  toast.className = "dice-toast visible";
  if (isFumble) toast.classList.add("dice-toast--fumble");
  if (isCrit)   toast.classList.add("dice-toast--crit");

  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove("visible"), 4000);
}

// == DOM helpers ==============================================================

let _dimCount = 0;
function _showDimOverlay() {
  _dimCount++;
  let bg = document.getElementById("dice-overlay");
  if (!bg) {
    bg = document.createElement("div");
    bg.id = "dice-overlay";
    document.body.appendChild(bg);
  }
  bg.classList.add("visible");
  return bg;
}

function _hideDimOverlay() {
  _dimCount = Math.max(0, _dimCount - 1);
  if (_dimCount === 0)
    document.getElementById("dice-overlay")?.classList.remove("visible");
}

function _buildDie(sides, value) {
  const el = document.createElement("div");
  el.className = `css-die css-die--d${sides}`;

  let label = String(value);
  if (sides === 20 && value === 20) label = "20✦";
  if (sides === 20 && value === 1)  label = "1☠";

  el.innerHTML = `<span class="css-die-face">${label}</span>`;
  return el;
}

// == Helpers ==================================================================

function _parseSides(notation) {
  const m = notation.match(/d(\d+)/i);
  return m ? parseInt(m[1]) : 20;
}

// == Inject styles (once) =====================================================

let _stylesInjected = false;
function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;

  const s = document.createElement("style");
  s.textContent = `
/* ── CSS Dice ──────────────────────────────────────────────────────────────── */
.css-die {
  position: fixed;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(145deg, #c8922a, #7a5010);
  color: #1a1208;
  font-family: 'Cinzel', 'Georgia', serif;
  font-weight: bold;
  font-size: 1.8rem;
  text-shadow: 0 1px 2px rgba(255,220,80,.6);
  box-shadow: 0 8px 32px rgba(0,0,0,.8), inset 0 2px 6px rgba(255,200,60,.25);
  border: 2px solid #e0a840;
  z-index: 9200;
  pointer-events: none;
  transform: translate(-50%, -50%);
  animation: dice-tumble-in 0.7s cubic-bezier(.22,.68,.6,1.4) forwards;
  will-change: transform, opacity;
}

.css-die--d4  { width:84px; height:84px; clip-path:polygon(50% 0%,0% 100%,100% 100%); font-size:1.5rem; }
.css-die--d6  { width:76px; height:76px; border-radius:12px; }
.css-die--d8  { width:80px; height:80px; clip-path:polygon(50% 0%,100% 50%,50% 100%,0% 50%); font-size:1.6rem; }
.css-die--d10 { width:80px; height:80px; clip-path:polygon(50% 0%,100% 38%,82% 100%,18% 100%,0% 38%); font-size:1.5rem; }
.css-die--d12 { width:86px; height:86px; clip-path:polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%); font-size:1.6rem; }
.css-die--d20 { width:92px; height:92px; clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%); font-size:1.3rem; }
.css-die--d100{ width:82px; height:82px; border-radius:50%; font-size:1.35rem; }

.css-die-face { line-height:1; letter-spacing:.02em; user-select:none; }
/* centroid offset for triangle/diamond shapes */
.css-die--d4  .css-die-face { margin-top:20px; }

.css-die.dice-settled {
  animation: dice-settle-glow 0.35s ease forwards;
}
.css-die.dice-fadeout {
  animation: dice-fade-out 0.4s ease forwards;
}

@keyframes dice-tumble-in {
  0%   { opacity:0; transform:translate(-50%,-50%) translateY(160px) rotate(-360deg) scale(.25); }
  70%  { opacity:1; transform:translate(-50%,-50%) translateY(-14px) rotate(12deg)  scale(1.15); }
  100% { opacity:1; transform:translate(-50%,-50%) translateY(0)      rotate(0deg)   scale(1); }
}
@keyframes dice-settle-glow {
  0%   { box-shadow:0 0 8px  rgba(255,200,60,.3),0 8px 32px rgba(0,0,0,.8); }
  50%  { box-shadow:0 0 44px rgba(255,200,60,1.0),0 8px 32px rgba(0,0,0,.8); }
  100% { box-shadow:0 0 22px rgba(255,200,60,.55),0 8px 32px rgba(0,0,0,.8); }
}
@keyframes dice-fade-out {
  0%   { opacity:1; transform:translate(-50%,-50%) scale(1); }
  100% { opacity:0; transform:translate(-50%,-50%) scale(1.35) translateY(-40px); }
}
/* ─────────────────────────────────────────────────────────────────────────── */
  `;
  document.head.appendChild(s);
}
