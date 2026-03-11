/**
 * StatsRadarChart.js
 *
 * Renders a hexagonal SVG spider / radar chart for the six D&D ability scores.
 * Mounts into any container element passed to mountRadarChart().
 *
 * Usage:
 *   import { mountRadarChart } from './StatsRadarChart.js';
 *   mountRadarChart(document.querySelector('#radar-panel'));
 */

import { gameStore } from "../../store/index.js";

const STATS = [
  { key: "str", label: "STR", icon: "⚔️" },
  { key: "dex", label: "DEX", icon: "🏹" },
  { key: "con", label: "CON", icon: "🩺" },
  { key: "int", label: "INT", icon: "📚" },
  { key: "wis", label: "WIS", icon: "🦉" },
  { key: "cha", label: "CHA", icon: "🎭" },
];

const MAX_SCORE = 20; // D&D 5e cap used for scale
const SVG_SIZE = 260;
const CX = SVG_SIZE / 2;
const CY = SVG_SIZE / 2;
const OUTER_R = 100;
const RINGS = 4; // background rings
const LABEL_OFFSET = 18;

/** Convert polar (angle, radius) to Cartesian SVG coords. */
function _polar(angleDeg, r) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

/** Build a polygon points string from an array of {x, y}. */
function _polyPoints(pts) {
  return pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}

/** Render the radar SVG for a given ability scores object. */
function _buildSVG(abilities) {
  const n = STATS.length;
  const angleStep = 360 / n;

  // Background rings
  const ringLines = Array.from({ length: RINGS }, (_, i) => {
    const r = (OUTER_R * (i + 1)) / RINGS;
    const pts = STATS.map((_, idx) => _polar(idx * angleStep, r));
    return `<polygon points="${_polyPoints(pts)}"
      fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
  }).join("\n");

  // Spoke lines
  const spokes = STATS.map((_, idx) => {
    const end = _polar(idx * angleStep, OUTER_R);
    return `<line x1="${CX}" y1="${CY}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}"
      stroke="rgba(255,255,255,0.10)" stroke-width="1"/>`;
  }).join("\n");

  // Data polygon
  const dataPts = STATS.map((s, idx) => {
    const score = abilities?.[s.key] ?? 10;
    const r = (Math.min(Math.max(score, 1), MAX_SCORE) / MAX_SCORE) * OUTER_R;
    return _polar(idx * angleStep, r);
  });

  const dataPolygon = `
    <polygon points="${_polyPoints(dataPts)}"
      fill="rgba(200,80,60,0.28)" stroke="#c8502a" stroke-width="2"
      stroke-linejoin="round"/>`;

  // Data dots
  const dots = dataPts
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4"
      fill="#c8502a" stroke="#1a1a1a" stroke-width="1.5"/>`,
    )
    .join("\n");

  // Labels
  const labels = STATS.map((s, idx) => {
    const score = abilities?.[s.key] ?? 10;
    const mod = Math.floor((score - 10) / 2);
    const modStr = mod >= 0 ? `+${mod}` : `${mod}`;
    const pos = _polar(idx * angleStep, OUTER_R + LABEL_OFFSET + 4);
    return `
      <text x="${pos.x.toFixed(2)}" y="${(pos.y - 6).toFixed(2)}"
        text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,sans-serif" font-size="11" font-weight="700"
        fill="#d4c9b0" letter-spacing="0.5">${s.label}</text>
      <text x="${pos.x.toFixed(2)}" y="${(pos.y + 7).toFixed(2)}"
        text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,sans-serif" font-size="10"
        fill="#c8922a">${score} (${modStr})</text>`;
  }).join("\n");

  return `
    <svg xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 ${SVG_SIZE} ${SVG_SIZE}"
      width="${SVG_SIZE}" height="${SVG_SIZE}"
      class="radar-svg">
      ${ringLines}
      ${spokes}
      ${dataPolygon}
      ${dots}
      ${labels}
    </svg>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
.radar-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
}
.radar-title {
  font-family: var(--font-title, "Cinzel", serif);
  font-size: 13px;
  letter-spacing: 1px;
  color: var(--color-accent, #c8922a);
  text-transform: uppercase;
  margin: 0;
}
.radar-svg {
  display: block;
  overflow: visible;
}
`;

let _cssInjected = false;
function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement("style");
  style.id = "radar-chart-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mount a reactive radar chart into `container`.
 * Subscribes to gameStore, re-renders when ability scores change.
 *
 * @param {HTMLElement} container
 * @returns {() => void} unsubscribe / cleanup function
 */
export function mountRadarChart(container) {
  if (!container) return () => {};
  _injectCSS();

  const render = (state) => {
    const abilities = state.player.abilities ?? {};
    container.innerHTML = `
      <div class="radar-wrap">
        <p class="radar-title">Képességek</p>
        ${_buildSVG(abilities)}
      </div>`;
  };

  return gameStore.subscribe(render);
}
