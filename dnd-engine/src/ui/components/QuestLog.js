/**
 * QuestLog.js — Quest log bottom drawer.
 *
 * Shows active / completed / failed quests from store.world.quests.
 * Slides up from the bottom of the screen.
 * Auto-updates when quests change.
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";

const STATUS_LABELS = {
  active: "Active",
  completed: "Completed",
  failed: "Failed",
};
const STATUS_ORDER = ["active", "completed", "failed"];

let _isOpen = false;

// ── Public API ────────────────────────────────────────────────────────────────

export function initQuestLog() {
  const drawer = document.createElement("div");
  drawer.id = "quest-drawer";
  drawer.setAttribute("role", "complementary");
  drawer.setAttribute("aria-label", "Quest Log");
  drawer.innerHTML = `
    <div class="ql-header">
      <h2 class="ql-title">📜 Quest Log</h2>
      <button id="btn-close-quests" class="ql-close" title="Close">✕</button>
    </div>
    <div class="ql-body" id="ql-body"></div>
  `;
  document.body.appendChild(drawer);

  document
    .getElementById("btn-close-quests")
    ?.addEventListener("click", closeQuestLog);

  // Re-render on quest or NPC changes
  gameStore.select(
    (s) => s.world.quests,
    (quests) => {
      if (_isOpen)
        _render(
          quests ?? [],
          gameStore.getState().world.npcRelationships ?? {},
        );
    },
  );

  gameStore.select(
    (s) => s.world.npcRelationships,
    (rels) => {
      if (_isOpen) _render(gameStore.getState().world.quests ?? [], rels ?? {});
    },
  );

  // Auto-open when a new quest is added (if drawer is closed)
  eventBus.on(EVENTS.QUEST_ADDED, () => {
    openQuestLog();
    const state = gameStore.getState();
    _render(state.world.quests ?? [], state.world.npcRelationships ?? {});
  });
}

export function openQuestLog() {
  _isOpen = true;
  const drawer = document.getElementById("quest-drawer");
  drawer?.classList.add("open");
  const state = gameStore.getState();
  _render(state.world.quests ?? [], state.world.npcRelationships ?? {});
}

export function closeQuestLog() {
  _isOpen = false;
  document.getElementById("quest-drawer")?.classList.remove("open");
}

export function toggleQuestLog() {
  _isOpen ? closeQuestLog() : openQuestLog();
}

// ── Renderer ──────────────────────────────────────────────────────────────────

const DISP_ICON = { friendly: "💬", neutral: "👤", hostile: "☠️" };
function _getDispLabel(disposition) {
  const lang =
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("dnd_lang")
      : null) ?? "hu";
  const labels =
    lang === "en"
      ? { friendly: "Friendly", neutral: "Neutral", hostile: "Hostile" }
      : { friendly: "Barátságos", neutral: "Semleges", hostile: "Ellenséges" };
  return labels[disposition] ?? disposition;
}

function _render(quests, npcRels = {}) {
  const body = document.getElementById("ql-body");
  if (!body) return;

  // ── Quest sections ────────────────────────────────────────────────────────
  const questHtml = (() => {
    if (quests.length === 0) {
      const lang =
        (typeof localStorage !== "undefined"
          ? localStorage.getItem("dnd_lang")
          : null) ?? "hu";
      return `<p class="ql-empty">${lang === "en" ? "No quests yet. Explore the world." : "Nincs még feladat. Fedezd fel a világot."}</p>`;
    }
    const grouped = Object.fromEntries(STATUS_ORDER.map((s) => [s, []]));
    quests.forEach((q) => {
      if (grouped[q.status]) grouped[q.status].push(q);
    });

    return STATUS_ORDER.filter((s) => grouped[s].length > 0)
      .map(
        (status) => `
        <div class="ql-group">
          <h3 class="ql-group-title ql-group--${status}">${STATUS_LABELS[status]}</h3>
          <ul class="ql-list">
            ${grouped[status]
              .map(
                (q) => `
              <li class="ql-quest ql-quest--${q.status}">
                <span class="ql-quest-pip" aria-hidden="true">${_pip(status)}</span>
                <div class="ql-quest-info">
                  <span class="ql-quest-title">${q.title}</span>
                  ${q.description ? `<span class="ql-quest-desc">${q.description}</span>` : ""}
                </div>
              </li>`,
              )
              .join("")}   
          </ul>
        </div>
      `,
      )
      .join("");
  })();

  // ── NPC relationship section ──────────────────────────────────────────────
  const npcEntries = Object.entries(npcRels);
  let npcHtml = "";
  if (npcEntries.length > 0) {
    npcHtml = `
      <div class="ql-group">
        <h3 class="ql-group-title">${typeof localStorage !== "undefined" && localStorage.getItem("dnd_lang") === "en" ? "NPC Relationships" : "NPC kapcsolatok"}</h3>
        <ul class="ql-list">
          ${npcEntries
            .map(([id, npc]) => {
              const icon = DISP_ICON[npc.disposition] ?? "👤";
              const label = _getDispLabel(npc.disposition);
              const lastNote = npc.notes?.at(-1) ?? "";
              return `
              <li class="ql-quest">
                <span class="ql-quest-pip">${icon}</span>
                <div class="ql-quest-info">
                  <span class="ql-quest-title">${npc.name ?? id}</span>
                  <span class="ql-quest-desc" style="color:var(--color-muted)">${label}${lastNote ? " — " + lastNote : ""}</span>
                </div>
              </li>`;
            })
            .join("")}
        </ul>
      </div>`;
  }

  body.innerHTML = questHtml + npcHtml;
}

function _pip(status) {
  return status === "completed" ? "✓" : status === "failed" ? "✗" : "◆";
}
