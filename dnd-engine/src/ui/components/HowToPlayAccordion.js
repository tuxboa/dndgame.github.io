/**
 * HowToPlayAccordion.js
 *
 * A collapsible numbered accordion explaining game mechanics.
 * Mounts into any container or defaults to #how-to-play-panel.
 *
 * Usage:
 *   import { initHowToPlayAccordion } from './HowToPlayAccordion.js';
 *   initHowToPlayAccordion();                  // auto-finds #how-to-play-panel
 *   initHowToPlayAccordion(myContainer);       // custom mount point
 */

// ── Content ───────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    title: "Az alapok — Hogyan kezdj?",
    body: `
      <p>Hozz létre egy karaktert a <strong>Karakter Készítő</strong> képernyőn.
      Válassz fajt (emberi, elf, törpe…), osztályt (harcos, varázsló, tolvaj…)
      és osszd el a képességpontjaidat.</p>
      <p>A kaland a fő narratív felületen indul. Írd be mi döntésed, majd a DM
      válasza megjelenik a képernyőn.</p>`,
  },
  {
    title: "Harc — Körre alapú küzdelem",
    body: `
      <p>Ha ellenség kerül a közeledbe, a harc automatikusan kezdeményezési
      dobással indul. Az iniciativa sorrendben mindenki megteszi a körét.</p>
      <ul>
        <li><strong>Támadás:</strong> Kattints a <em>Támadás</em> gombra. A rendszer
        automatikusan dob d20-t a támadás bónuszaiddal.</li>
        <li><strong>Mozgás:</strong> A taktikai térképen kattints a célmezőre
        a mozgáshoz (kör/mozgássebesség).</li>
        <li><strong>Varázslat:</strong> A varázslat panelből válassz, majd erősítsd meg.</li>
        <li><strong>Cselekvés megvonása:</strong> Nyomj <em>Kihagyás</em>t, ha nem akarsz
        cselekedni.</li>
      </ul>`,
  },
  {
    title: "Varázslatok és Varázslókönyv",
    body: `
      <p>Ismert varázslatait a <strong>Varázslatok</strong> panelen láthatod.
      A beírt varázslatoknál a varázslókönyv szükséges az előkészítéshez.</p>
      <p>Minden egyes varázslat mana-pontot vagy bővítőhelyet fogyaszt.
      A rövid pihenő visszatölti a mana felét; a hosszú pihenő mindent visszaad.</p>
      <p><em>Koncentráció</em> varázslatoknál csak egyet tarthatsz fenn egyszerre —
      ha sebet kapsz, CON mentő dob dönti el, tart-e a varázslat.</p>`,
  },
  {
    title: "Felszerelés és Leltár",
    body: `
      <p>A <strong>Leltár</strong> panelen kezelheted az összes tárgyadat.
      Kattints egy tárgyra → <em>Felszerel / Levesz</em>.</p>
      <ul>
        <li><strong>Sokoldalú fegyverek</strong>: Ha nincs pajzsod vagy másik fegyvered,
        kétkezes fogással nagyobb dobókockával támadhatsz.</li>
        <li><strong>Páncél</strong>: Az AC automatikusan frissül felszereléskor.</li>
        <li><strong>Kiegészítők</strong>: Növelik a képességeket vagy passzív bónuszokat adnak.</li>
      </ul>`,
  },
  {
    title: "Pihenés és Gyógyulás",
    body: `
      <p><strong>Rövid pihenő</strong> (kb. 1 óra a játékvilágban): aktiválható a
      pihentető gombbal. Visszaad életpontokat Életerő Kocka dobással,
      visszatölti a <em>Második Szél</em>-t és a mana felét.</p>
      <p><strong>Hosszú pihenő</strong> (éjszaka): teljesen visszaállítja az ÉP-t,
      mana-t, varázslóhely-eket és töltőteljességű osztályképességeket.</p>`,
  },
  {
    title: "Szintlépés és Képességfejlesztés",
    body: `
      <p>A szintlépés automatikusan ajánlott, ha elegendő XP gyűlt fel.
      A szintléptetési képernyőn választhatsz:</p>
      <ul>
        <li>Képességpont növelés (+2 egy képességhez, vagy +1 kettőhöz)</li>
        <li>Bravúr (Feat) — egyedi képzettség</li>
        <li>Bizonyos osztályoknál varázslatvariánsok</li>
      </ul>
      <p>Bárd 9. szinten elérheted a <em>Mágikus Titkok</em> képességet,
      amellyel bármely osztály varázslatát megtanulhatod!</p>`,
  },
  {
    title: "Értékek és Képességdobások",
    body: `
      <p>A hat képességpont határozza meg az összes ellenőrzést és mentődobást:</p>
      <table class="htp-table">
        <tr><th>Erő (STR)</th><td>Atléta, emeléstárgyak, melee-támadások</td></tr>
        <tr><th>Ügyesség (DEX)</th><td>Lopakodás, távolsági harc, finesse-fegyverek</td></tr>
        <tr><th>Állóképesség (CON)</th><td>Max ÉP, koncentráció mentők</td></tr>
        <tr><th>Értelem (INT)</th><td>Arkán varázsló, ismeretdobások</td></tr>
        <tr><th>Bölcsesség (WIS)</th><td>Észlelés, gyógyítás, druid/papvarázsló</td></tr>
        <tr><th>Karizma (CHA)</th><td>Meggyőzés, megfélemlítés, bárd/varázsló</td></tr>
      </table>`,
  },
  {
    title: "Kereskedés és NPC kapcsolatok",
    body: `
      <p>Kereskedőknél az <em>NPC kapcsolat</em> befolyásolja az árakat:
      barátságos kereskedőnél <strong>−20%</strong>, ellenséges kereskedőnél
      <strong>+20%</strong> árak érvényesek.</p>
      <p>A kapcsolatod a világgal az NPC-kkel folytatott párbeszédek és döntések
      alapján változik — törődjj rájuk!</p>`,
  },
  {
    title: "Tippek és trükkök",
    body: `
      <ul>
        <li>Támadj <em>előnyből</em> (prone, vakított, megrettent ellenfél): automatikusan
        a legjobb d20-t veszi figyelembe a rendszer.</li>
        <li>A <em>Szerencsés</em> bravúr lehetővé teszi a legkedvezőtlenebb dobás
        újradobását.</li>
        <li>Koncentrációs varázslatokból egyszerre csak egyet tarthatsz fenn,
        de több koncentrálóhely nélküli varázslat hathat egyszerre.</li>
        <li>Az automatikus mentor (DM AI) segít stratégiákat javasolni, ha kéred.</li>
      </ul>`,
  },
];

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
.htp-wrap {
  padding: 6px 0;
}
.htp-title {
  font-family: var(--font-title, "Cinzel", serif);
  font-size: 14px;
  letter-spacing: 1px;
  color: var(--color-accent, #c8922a);
  text-transform: uppercase;
  margin: 0 0 10px;
  padding: 0 4px;
}
.htp-item {
  border-radius: var(--radius, 6px);
  overflow: hidden;
  border: 1px solid var(--color-border, #2d2d35);
  margin-bottom: 5px;
  transition: border-color var(--transition, 0.18s ease);
}
.htp-item.open { border-color: var(--color-accent-dim, #7a5918); }
.htp-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  background: var(--color-surface-2, #1e1e22);
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition, 0.18s ease);
  outline: none;
}
.htp-btn:hover { background: #26262c; }
.htp-num {
  font-family: var(--font-title, "Cinzel", serif);
  font-size: 13px;
  color: var(--color-accent, #c8922a);
  min-width: 22px;
  text-align: right;
}
.htp-label {
  flex: 1;
  font-family: var(--font-ui, system-ui, sans-serif);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text, #d4c9b0);
}
.htp-chevron {
  font-size: 12px;
  color: var(--color-text-dim, #7a7465);
  transition: transform var(--transition, 0.18s ease);
}
.htp-item.open .htp-chevron { transform: rotate(90deg); }
.htp-body {
  display: none;
  padding: 10px 14px 12px;
  background: var(--color-surface, #161619);
  border-top: 1px solid var(--color-border, #2d2d35);
  font-family: var(--font-body, "Crimson Text", serif);
  font-size: 14px;
  color: var(--color-text, #d4c9b0);
  line-height: 1.6;
}
.htp-item.open .htp-body { display: block; }
.htp-body p { margin: 0 0 7px; }
.htp-body p:last-child { margin: 0; }
.htp-body ul { margin: 4px 0 4px 16px; padding: 0; }
.htp-body li { margin-bottom: 4px; }
.htp-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 6px;
  font-size: 13px;
}
.htp-table th {
  text-align: left;
  color: var(--color-accent, #c8922a);
  font-weight: 700;
  padding: 3px 8px 3px 0;
  white-space: nowrap;
}
.htp-table td { color: var(--color-text-dim, #7a7465); padding: 3px 0; }
`;

let _cssInjected = false;
function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const el = document.createElement("style");
  el.id = "htp-accordion-css";
  el.textContent = CSS;
  document.head.appendChild(el);
}

// ── Render ────────────────────────────────────────────────────────────────────

function _render(container) {
  container.innerHTML = `
    <div class="htp-wrap">
      <p class="htp-title">Hogyan játssz?</p>
      ${SECTIONS.map(
        (s, i) => `
        <div class="htp-item" id="htp-item-${i}">
          <button class="htp-btn" data-idx="${i}" aria-expanded="false">
            <span class="htp-num">${i + 1}.</span>
            <span class="htp-label">${s.title}</span>
            <span class="htp-chevron">▶</span>
          </button>
          <div class="htp-body">${s.body}</div>
        </div>`,
      ).join("")}
    </div>`;

  container.querySelectorAll(".htp-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = btn.dataset.idx;
      const item = container.querySelector(`#htp-item-${idx}`);
      const isOpen = item.classList.contains("open");
      // Close all, open clicked
      container
        .querySelectorAll(".htp-item")
        .forEach((el) => el.classList.remove("open"));
      container
        .querySelectorAll(".htp-btn")
        .forEach((el) => el.setAttribute("aria-expanded", "false"));
      if (!isOpen) {
        item.classList.add("open");
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mount the How To Play accordion into a container.
 *
 * @param {HTMLElement} [customContainer] — defaults to #how-to-play-panel
 */
export function initHowToPlayAccordion(customContainer) {
  _injectCSS();

  const container =
    customContainer ??
    document.getElementById("how-to-play-panel") ??
    (() => {
      const div = document.createElement("div");
      div.id = "how-to-play-panel";
      document.body.appendChild(div);
      return div;
    })();

  _render(container);
}
