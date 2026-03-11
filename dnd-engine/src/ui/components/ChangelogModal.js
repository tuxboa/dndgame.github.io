/**
 * ChangelogModal.js
 *
 * A scrollable timeline modal with entries grouped by month.
 * Uses a custom crimson (--color-danger) scrollbar.
 *
 * Usage:
 *   import { initChangelog } from './ChangelogModal.js';
 *   initChangelog();              // attaches to button#changelog-btn
 *   initChangelog(myTriggerEl);   // or pass your own trigger element
 */

// ── Changelog data ────────────────────────────────────────────────────────────
// Grouped by { month, entries: [{ type, text }] }
// type: 'feat' | 'fix' | 'balance' | 'ui' | 'system'

const CHANGELOG = [
  {
    month: "2025 Június",
    entries: [
      {
        type: "feat",
        text: "Összetett kaland-motor: DM AI vezérelt narratíva OpenAI API-val",
      },
      {
        type: "feat",
        text: "Taktikai harctérkép (20×14 rács, ős-sötétség, akadályok)",
      },
      {
        type: "feat",
        text: "Halálos mentődobás rendszer (3 sikeres / 3 sikertelen)",
      },
      {
        type: "feat",
        text: "Varázskönyv: ismert és előkészített varázslatok kezelése",
      },
      {
        type: "feat",
        text: "Harcos osztály: Második Szél, Extra Támadás 5. szinten",
      },
      { type: "feat", text: "Barbár osztály: Düh (Rage) rendszer, Vad Érzék" },
      {
        type: "feat",
        text: "Bárd osztály: Bárd-inspiráció, harci / gyógyító varázslatcsomag",
      },
      {
        type: "feat",
        text: "Ranger osztály: Hunter's Mark, Kedvezett Ellenség passzív",
      },
      {
        type: "feat",
        text: "Szintléptetési rendszer XP-alapú ranglétrával (1-10. szint)",
      },
      {
        type: "feat",
        text: "Leltárrendszer: felszerelés, lerakás, aranyvaluta",
      },
      {
        type: "feat",
        text: "Kereskedő felület: NPC-viszony alapú árkorrekció (−20% / +20%)",
      },
      {
        type: "feat",
        text: "Küldetésnapló: aktív, teljesített, kudarcba fulladt állapotok",
      },
      {
        type: "feat",
        text: "Pihenőrendszer: rövid + hosszú pihenő, Életerő Kocka",
      },
    ],
  },
  {
    month: "2025 Július — Taktikai frissítés",
    entries: [
      {
        type: "feat",
        text: "Ős-sötétség (Fog of War) láthatóság rácshoz kötött számítással",
      },
      { type: "feat", text: "Akadályok ütközésdetekciója mozgáskor" },
      { type: "feat", text: "Íjász-ívszakasz animáció (távolsági harc)" },
      {
        type: "feat",
        text: "Sokoldalú fegyverek: Hosszúkard, Csatabárd, Háborús kalapács, Dárda, Vándorbot",
      },
      {
        type: "feat",
        text: "Repülő/Reach fegyver-tartomány (dárda: 2 mezős elérési távolság)",
      },
      {
        type: "feat",
        text: "Bárd 9. szint: Mágikus Titkok — bármely osztály varázslata megtanulható",
      },
      {
        type: "fix",
        text: "baseDmgBonus (Kapitány Hosszúkardja +1) most helyesen alkalmazódik",
      },
      {
        type: "fix",
        text: "Ellenség előny/hátrány: prone & vakított feltételek javítva",
      },
      { type: "fix", text: "Halál-mentődobás UI időzítési probléma kijavítva" },
      {
        type: "balance",
        text: "Koncentrációs varázslatok (Áldás, Hitalap Pajzs) megfelelően törlésre kerülnek",
      },
      {
        type: "ui",
        text: "NPC viszony jelvény a kereskedő felületen (😊 / 😠 + ár delta)",
      },
      {
        type: "ui",
        text: "Rang- és Haladás Modal: kalandkörök, rangszintek, haladási sáv",
      },
      {
        type: "ui",
        text: "Statisztika Radar Chart: hatszögű SVG pók-diagram a hat képességhez",
      },
      {
        type: "ui",
        text: "RPG Navigációs sáv: LELTÁR · VARÁZSLATOK · VARÁZSKÖNYV · ÁLDÁSOK",
      },
      { type: "ui", text: "Hogyan játssz? Accordion: 9 összecsukható szekció" },
      { type: "ui", text: "Changelog Timeline Modal (ez a képernyő!)" },
      {
        type: "system",
        text: "Vite 5 + ES modulok, GitHub Pages automatikus telepítés",
      },
    ],
  },
];

// ── Type config ───────────────────────────────────────────────────────────────

const TYPE_META = {
  feat: { label: "ÚJ", color: "#2e7d47", bg: "rgba(46,125,71,0.15)" },
  fix: { label: "JAVÍTÁS", color: "#c8922a", bg: "rgba(200,146,42,0.12)" },
  balance: {
    label: "EGYENSÚLY",
    color: "#5b9abf",
    bg: "rgba(91,154,191,0.12)",
  },
  ui: { label: "UI", color: "#7b68ee", bg: "rgba(123,104,238,0.12)" },
  system: { label: "RENDSZER", color: "#7a7465", bg: "rgba(122,116,101,0.10)" },
};

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
.cl-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2100;
  padding: 12px;
}
.cl-modal {
  position: relative;
  background: var(--color-surface, #161619);
  border: 1px solid var(--color-border, #2d2d35);
  border-radius: var(--radius, 6px);
  width: 100%;
  max-width: 460px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 10px 50px rgba(0,0,0,0.8);
}
.cl-header {
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--color-border, #2d2d35);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.cl-header-title {
  font-family: var(--font-title, "Cinzel", serif);
  font-size: 17px;
  color: var(--color-accent, #c8922a);
  margin: 0;
  letter-spacing: 1px;
}
.cl-close {
  background: none;
  border: none;
  color: var(--color-text-dim, #7a7465);
  font-size: 16px;
  cursor: pointer;
  padding: 4px 6px;
  transition: color var(--transition, 0.18s ease);
  line-height: 1;
}
.cl-close:hover { color: var(--color-text, #d4c9b0); }
.cl-body {
  overflow-y: auto;
  padding: 14px 18px 18px;
  flex: 1;
  /* Custom red scrollbar */
  scrollbar-width: thin;
  scrollbar-color: var(--color-danger, #9b2335) rgba(0,0,0,0.2);
}
.cl-body::-webkit-scrollbar { width: 6px; }
.cl-body::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 3px; }
.cl-body::-webkit-scrollbar-thumb { background: var(--color-danger, #9b2335); border-radius: 3px; }
.cl-body::-webkit-scrollbar-thumb:hover { background: #bb2d42; }
.cl-month {
  margin-bottom: 22px;
}
.cl-month-label {
  font-family: var(--font-title, "Cinzel", serif);
  font-size: 12px;
  letter-spacing: 1.2px;
  color: var(--color-text-dim, #7a7465);
  text-transform: uppercase;
  margin: 0 0 10px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--color-border, #2d2d35);
}
.cl-timeline {
  position: relative;
  padding-left: 14px;
}
.cl-timeline::before {
  content: "";
  position: absolute;
  left: 5px; top: 0; bottom: 0;
  width: 2px;
  background: linear-gradient(to bottom, var(--color-danger, #9b2335), transparent);
  border-radius: 1px;
}
.cl-entry {
  position: relative;
  margin-bottom: 8px;
  padding: 7px 10px;
  border-radius: var(--radius, 6px);
  font-family: var(--font-body, "Crimson Text", serif);
  font-size: 14px;
  color: var(--color-text, #d4c9b0);
  line-height: 1.45;
}
.cl-entry::before {
  content: "";
  position: absolute;
  left: -11px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--color-danger, #9b2335);
  border: 1px solid var(--color-bg, #0d0d0f);
}
.cl-tag {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  font-family: var(--font-ui, system-ui, sans-serif);
  letter-spacing: 0.6px;
  margin-right: 6px;
  vertical-align: middle;
  line-height: 16px;
}
`;

let _cssInjected = false;
function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const el = document.createElement("style");
  el.id = "changelog-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ── Build HTML ────────────────────────────────────────────────────────────────

function _buildHTML() {
  const months = CHANGELOG.map((group) => {
    const entries = group.entries
      .map((e) => {
        const meta = TYPE_META[e.type] ?? TYPE_META.feat;
        return `
        <div class="cl-entry" style="background:${meta.bg}">
          <span class="cl-tag" style="color:${meta.color};background:${meta.bg};border:1px solid ${meta.color}">${meta.label}</span>${e.text}
        </div>`;
      })
      .join("");
    return `
      <div class="cl-month">
        <p class="cl-month-label">${group.month}</p>
        <div class="cl-timeline">${entries}</div>
      </div>`;
  }).join("");

  return `
    <div class="cl-backdrop" id="cl-backdrop">
      <div class="cl-modal" role="dialog" aria-modal="true" aria-label="Változásnapló">
        <div class="cl-header">
          <h2 class="cl-header-title">Változásnapló</h2>
          <button class="cl-close" id="cl-close-btn" aria-label="Bezárás">✕</button>
        </div>
        <div class="cl-body">${months}</div>
      </div>
    </div>`;
}

// ── Open / close state ────────────────────────────────────────────────────────

let _el = null;

function _open() {
  if (_el) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = _buildHTML();
  _el = tmp.firstElementChild;
  document.body.appendChild(_el);

  _el.querySelector("#cl-close-btn")?.addEventListener("click", _close);
  _el.addEventListener("click", (e) => {
    if (e.target === _el) _close();
  });
}

function _close() {
  _el?.remove();
  _el = null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the changelog modal.
 *
 * @param {HTMLElement} [triggerEl] — defaults to #changelog-btn
 * @returns {{ open: Function, close: Function }}
 */
export function initChangelog(triggerEl) {
  _injectCSS();

  const trigger = triggerEl ?? document.getElementById("changelog-btn");
  trigger?.addEventListener("click", _open);

  return { open: _open, close: _close };
}
