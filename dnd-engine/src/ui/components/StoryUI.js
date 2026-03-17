/**
 * StoryUI.js — Renders the static Story Engine output into the game shell.
 *
 * WHAT IT DOES
 * ─────────────────────────────────────────────────────────────────────────────
 * • On STORY_NODE_CHANGED: appends the node title + description to the
 *   narrative log, then renders choice buttons in #story-choices.
 * • On COMBAT_STARTED:  hides choice buttons (can't choose while fighting).
 * • On COMBAT_ENDED:    restores choice buttons.
 * • On STORY_SKILL_CHECK_START: disables buttons + shows a "Rolling…" state.
 * • On STORY_SKILL_CHECK_END:   re-enables buttons.
 *
 * WHAT IT DOESN'T DO
 * ─────────────────────────────────────────────────────────────────────────────
 * • Never calls setState directly — all state mutations go through storyManager
 * • Never imports storyManager — communication is one-way via executeChoice()
 *   which is passed in at init time (dependency injection keeps coupling loose)
 */

import { eventBus, EVENTS } from "../../engine/eventBus.js";
import { campaignManager } from "../../engine/CampaignManager.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const CHOICE_ICONS = {
  navigate: "👣",
  combat: "⚔️",
  loot: "🪙",
  skillCheck: "🎲",
  addQuest: "📜",
  shop: "🛒",
};

// ── Module state ──────────────────────────────────────────────────────────────

/** Current node whose choices are displayed — needed for re-render after combat */
let _choicesLocked = false;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the Story UI.
 * Injects #story-choices into the footer and wires all event listeners.
 *
 * @param {Function} onChoiceClick - Called with a Choice object when player picks one
 */
export function initStoryUI(onChoiceClick) {
  _injectChoicesContainer();

  // ── Node rendered ────────────────────────────────────────────────────────
  eventBus.on(EVENTS.STORY_NODE_CHANGED, ({ node }) => {
    _choicesLocked = false;
    _renderNodeEntry(node);
    _renderChoices(node, onChoiceClick);
    _showNarrativeMode();
  });

  // ── CampaignManager scene rendered ─────────────────────────────────────
  eventBus.on(EVENTS.SCENE_LOADED, ({ scene }) => {
    if (!scene) return;

    _choicesLocked = false;

    if (
      scene.type === "narrative" ||
      scene.type === "skill_check" ||
      scene.type === "interrogation"
    ) {
      _showNarrativeMode();
      _renderCampaignScene(scene);
    }
  });

  eventBus.on(EVENTS.COMBAT_TRIGGERED, () => {
    _showCombatMode();
    _lockChoices();
  });

  // ── Combat started: hide choices ─────────────────────────────────────────
  eventBus.on(EVENTS.COMBAT_STARTED, () => {
    _showCombatMode();
    _lockChoices();
    document
      .querySelector("#story-choices")
      ?.classList.add("story-choices--hidden");
  });

  // ── Combat ended: restore choices ────────────────────────────────────────
  eventBus.on(EVENTS.COMBAT_ENDED, () => {
    _showNarrativeMode();
    // Choices will be replaced when storyManager navigates to victoryNode
    // (which fires STORY_NODE_CHANGED). Just ensure the container is visible
    // so the new choices are shown when they arrive.
    document
      .querySelector("#story-choices")
      ?.classList.remove("story-choices--hidden");
  });

  // ── Skill check: lock buttons while d20 animates ─────────────────────────
  eventBus.on(EVENTS.STORY_SKILL_CHECK_START, ({ skill, dc }) => {
    _choicesLocked = true;
    const bar = document.querySelector("#story-choices");
    if (bar) {
      bar.querySelectorAll(".story-choice-btn").forEach((btn) => {
        btn.disabled = true;
      });
      const hint = document.createElement("p");
      hint.id = "skill-check-hint";
      hint.className = "story-skill-hint";
      hint.textContent = `🎲 Rolling ${skill} check (DC ${dc})…`;
      bar.appendChild(hint);
    }
  });

  eventBus.on(EVENTS.STORY_SKILL_CHECK_END, () => {
    _choicesLocked = false;
    document.querySelector("#skill-check-hint")?.remove();
    // Choices will be replaced by the incoming STORY_NODE_CHANGED after navigation
  });

  // ── Shop closed: re-enable choices so player can pick again ──────────────
  eventBus.on(EVENTS.SHOP_CLOSED, () => {
    _choicesLocked = false;
    document.querySelectorAll(".story-choice-btn").forEach((b) => {
      b.disabled = false;
    });
  });

  // ── Rest completed: re-enable choices (rest doesn't navigate away) ──────
  eventBus.on(EVENTS.REST_COMPLETED, () => {
    _choicesLocked = false;
    document.querySelectorAll(".story-choice-btn").forEach((b) => {
      b.disabled = false;
    });
  });
}

function _renderCampaignScene(scene) {
  const log = document.querySelector("#narrative-log");
  if (log) {
    const entry = document.createElement("div");
    entry.className =
      "story-node-entry story-node-entry--active story-node-entry--enter";

    const desc = document.createElement("p");
    desc.className = "story-node-desc";
    desc.textContent = String(scene.text ?? "");

    entry.appendChild(desc);

    if (scene.type === "interrogation") {
      const hint = document.createElement("p");
      hint.className = "story-node-desc";
      hint.textContent =
        "💬 Írj szabad szöveget a kihallgatáshoz az alsó mezőbe.";
      entry.appendChild(hint);
    }

    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  const bar = document.querySelector("#story-choices");
  if (!bar) return;

  bar.innerHTML = "";
  bar.classList.remove("story-choices--hidden");

  const choices = Array.isArray(scene.choices) ? scene.choices : [];
  if (choices.length === 0) {
    bar.innerHTML = `<p class="story-no-choices">— A jelenet véget ért —</p>`;
    return;
  }

  choices.forEach((choice, index) => {
    const button = document.createElement("button");
    button.className = "story-choice-btn";
    button.dataset.choiceIdx = String(index);
    button.textContent = String(choice.text ?? "Tovább");

    button.addEventListener("click", () => {
      if (_choicesLocked) return;

      _choicesLocked = true;
      bar.querySelectorAll(".story-choice-btn").forEach((b) => {
        b.disabled = true;
      });

      campaignManager.makeChoice(choice);
    });

    bar.appendChild(button);
  });
}

function _showNarrativeMode() {
  const narrative =
    document.querySelector("#narrative-ui") ??
    document.querySelector("#narrative-log");
  const combat =
    document.querySelector("#combat-ui") ??
    document.querySelector(".runtime-log-grid");

  if (narrative) {
    narrative.classList.remove("story-mode-hidden");
    narrative.classList.add("story-mode-active");
  }

  if (combat) {
    combat.classList.remove("story-mode-active", "fall-in-animation");
    combat.classList.add("story-mode-hidden");
  }
}

function _showCombatMode() {
  const narrative =
    document.querySelector("#narrative-ui") ??
    document.querySelector("#narrative-log");
  const combat =
    document.querySelector("#combat-ui") ??
    document.querySelector(".runtime-log-grid");

  if (narrative) {
    narrative.classList.remove("story-mode-active");
    narrative.classList.add("story-mode-hidden");
  }

  if (combat) {
    combat.classList.remove("story-mode-hidden");
    combat.classList.add("story-mode-active", "fall-in-animation");
  }
}

// ── Private: DOM Manipulation ─────────────────────────────────────────────────

/**
 * Insert the #story-choices container above the #action-bar in the footer.
 */
function _injectChoicesContainer() {
  if (document.querySelector("#story-choices")) return; // already mounted

  const footer = document.querySelector(".game-footer");
  if (!footer) {
    console.warn(
      "[StoryUI] .game-footer not found — cannot mount choices container",
    );
    return;
  }

  const container = document.createElement("div");
  container.id = "story-choices";
  container.className = "story-choices";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Story choices");

  // Insert before the first child (above #action-bar and the input row)
  footer.insertBefore(container, footer.firstChild);
}

/**
 * Append the node's title and description as a new entry in the narrative log.
 */
function _renderNodeEntry(node) {
  const log = document.querySelector("#narrative-log");
  if (!log) return;

  // Remove the previous "active" flag so only the latest node is highlighted
  log.querySelectorAll(".story-node-entry--active").forEach((el) => {
    el.classList.remove("story-node-entry--active");
  });

  const entry = document.createElement("div");
  entry.className =
    "story-node-entry story-node-entry--active story-node-entry--enter";
  entry.dataset.nodeId = node.id;

  const icon = node.image
    ? `<span class="story-node-icon">${node.image}</span>`
    : "";

  entry.innerHTML = `
    <div class="story-node-header">
      ${icon}
      <h3 class="story-node-title">${node.title}</h3>
    </div>
    <p class="story-node-desc">${node.description}</p>
  `;

  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

/**
 * Render choice buttons in #story-choices.
 */
function _renderChoices(node, onChoiceClick) {
  const bar = document.querySelector("#story-choices");
  if (!bar) return;

  bar.innerHTML = "";
  bar.classList.remove("story-choices--hidden");

  if (!node.choices?.length) {
    bar.innerHTML = `<p class="story-no-choices">— The path ends here —</p>`;
    return;
  }

  node.choices.forEach((choice, index) => {
    const btn = document.createElement("button");
    btn.className = `story-choice-btn story-choice-btn--${choice.type}`;
    btn.dataset.choiceIdx = index;

    const icon = CHOICE_ICONS[choice.type] ?? "▶";
    btn.innerHTML = `<span class="choice-icon">${icon}</span> <span class="choice-label">${choice.label}</span>`;

    btn.addEventListener("click", () => {
      if (_choicesLocked) return;

      // Shop / rest choices don't navigate away — keep choices enabled so
      // the player can still interact after the action resolves.
      if (choice.type === "shop" || choice.type === "rest") {
        onChoiceClick(choice);
        return;
      }

      _choicesLocked = true; // prevent double-click while action resolves

      // Visual feedback
      bar.querySelectorAll(".story-choice-btn").forEach((b) => {
        b.disabled = true;
        b.classList.remove("story-choice-btn--selected");
      });
      btn.classList.add("story-choice-btn--selected");

      onChoiceClick(choice);
    });

    bar.appendChild(btn);
  });
}

function _lockChoices() {
  _choicesLocked = true;
  document.querySelectorAll(".story-choice-btn").forEach((b) => {
    b.disabled = true;
  });
}
