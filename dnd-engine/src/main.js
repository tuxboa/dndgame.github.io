/**
 * main.js — Application bootstrap
 *
 * Initialisation order matters:
 *   1. EventBus (debug mode in dev)
 *   2. CampaignLoader (seeds the DM store slice)
 *   3. DMController (needs campaign data)
 *   4. UI components
 *   5. Start game
 */

import "./style.css";
import { eventBus, EVENTS } from "./engine/eventBus.js";
import { campaignManager } from "./engine/CampaignManager.js";
import { initAtmosphereSystem } from "./engine/AtmosphereSystem.js";
import { initInterrogationSystem } from "./engine/InterrogationSystem.js";
import { initChronicleManager } from "./engine/ChronicleManager.js";
import { gameStore } from "./store/index.js";
import { geminiDMService } from "./services/GeminiDMService.js";
import { initPlayerEcsBridge } from "./ecs/playerEcsBridge.js";
import { loadCampaign } from "./data/campaignLoader.js";
import demoCampaign from "./campaigns/demo_campaign.json";
import { initDM, processTurn } from "./systems/dmController.js";
import { initDiceUI } from "./ui/components/DiceRollerUI.js";
import { initDiceBoxUI } from "./ui/components/DiceBoxUI.js";
import { mountCharacterCreation } from "./ui/components/CharacterCreation.js";
import { initCombatUI } from "./ui/components/CombatUI.js";
import { initDispatcher } from "./engine/actionDispatcher.js";
import { initStory, startStory } from "./systems/storyManager.js";
import { initStoryUI } from "./ui/components/StoryUI.js";
import { executeChoice } from "./systems/storyManager.js";
import { initMana } from "./systems/spellSystem.js";
import {
  initEquipment,
  equipItem as autoEquipItem,
  isEquippable,
} from "./systems/equipmentSystem.js";
import { initLevelUpUI } from "./ui/components/LevelUpUI.js";
import { initMerchantUI } from "./ui/components/MerchantUI.js";
import { initAudio } from "./systems/audioSystem.js";
import { initCombatDamagePipeline } from "./systems/combatDamagePipeline.js";
import { initVisualEffectSystem } from "./systems/visualEffectSystem.js";
import { initCombatLogUI } from "./systems/combatLogUI.js";
import { initActionInput } from "./ui/components/ActionInputUI.js";
import { initChronicleUI } from "./ui/components/ChronicleUI.js";
import { initCombatMap } from "./ui/components/CombatMapEngine.js";
import { mountMainMenu } from "./ui/components/MainMenuUI.js";
import {
  initInventoryUI,
  toggleInventory,
  closeInventory,
} from "./ui/components/InventoryPanel.js";
import {
  initCharacterSheet,
  toggleCharacterSheet,
  closeCharacterSheet,
} from "./ui/components/CharacterSheet.js";
import {
  initQuestLog,
  toggleQuestLog,
  closeQuestLog,
} from "./ui/components/QuestLog.js";
import {
  initSessionPanel,
  toggleSessionPanel,
} from "./ui/components/SessionPanel.js";
import {
  saveGame,
  loadGame,
  hasSavedGame,
  listSaves,
  deleteSave,
  enableAutosave,
  exportSave,
  importSave,
} from "./systems/saveSystem.js";
import {
  listEncounters,
  startStaticEncounter,
  DIFFICULTY_COLOUR,
} from "./data/encounters.js";
import { mountRadarChart } from "./ui/components/StatsRadarChart.js";
import { initRankModal } from "./ui/components/RankProgressionModal.js";
import { initHowToPlayAccordion } from "./ui/components/HowToPlayAccordion.js";
import { initChangelog } from "./ui/components/ChangelogModal.js";

// ── Dev: expose state to DevTools ─────────────────────────────────────────────
if (import.meta.env.DEV) {
  window.__store__ = gameStore;
  window.__events__ = EVENTS;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap() {
  const app = document.querySelector("#app");
  if (!app) {
    throw new Error('Hiányzik a gyökér DOM elem: "#app".');
  }

  // ── Step 1: Mount pre-game containers ────────────────────────────────────────
  app.innerHTML = `
    <div id="main-menu-container"></div>
    <div id="game-container" class="game-container--hidden"></div>
  `;

  const menuEl = document.querySelector("#main-menu-container");
  const gameEl = document.querySelector("#game-container");

  // ── Step 2: Main Menu — blocks until the player makes a choice ───────────────
  const menuResult = await mountMainMenu(menuEl);
  menuEl.remove();

  // ── Step 3: Load campaign ─────────────────────────────────────────────────────
  // resumeSave uses the default path; new game uses the path chosen in the menu.
  let campaign;
  try {
    const campaignPath = menuResult.resumeSave
      ? undefined
      : menuResult.campaignPath;
    campaign = await loadCampaign(campaignPath);
  } catch (err) {
    renderFatalScreen("Failed to load campaign", err);
    return;
  }

  // ── Step 4: Seed player data from Menu selection (new game only) ─────────────
  if (!menuResult.resumeSave && menuResult.playerData) {
    gameStore.setState(
      {
        player: { ...gameStore.getState().player, ...menuResult.playerData },
        session: {
          ...gameStore.getState().session,
          localPlayerId: "player",
          currentTurnPlayerId: "player",
          isMyTurn: true,
        },
      },
      "mainMenu:seedPlayer",
    );
  }

  // ── Step 4b: Init ECS bridge (player entity + component sync) ──────────────
  initPlayerEcsBridge();

  // ── Step 5: Reveal game container with a cinematic fade ──────────────────────
  gameEl.classList.remove("game-container--hidden");
  gameEl.classList.add("game-container--enter");

  // ── Step 6: DM controller ─────────────────────────────────────────────────────
  initDM();

  // ── Step 7: Render game UI shell into #game-container ────────────────────────
  renderUI(gameEl, campaign);
  wireUI();
  subscribeToStore();

  // Step 3b: Init subsystems
  initAudio();
  initCombatLogUI();
  if (!geminiDMService) {
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: "Gemini narráció kikapcsolva (hiányzó API kulcs).",
      type: "warning",
      ttl: 4500,
    });
  }
  geminiDMService?.initialize();
  initVisualEffectSystem();
  initCombatDamagePipeline();
  initDispatcher(); // Must be first — wires COMBAT_REQUESTED → startCombat
  initCombatUI();
  initInventoryUI();
  initCharacterSheet();
  initQuestLog();
  initSessionPanel();
  initStory();
  initStoryUI(executeChoice);
  initInterrogationSystem();
  initChronicleManager();
  initChronicleUI();
  initAtmosphereSystem();

  eventBus.on(EVENTS.COMBAT_TRIGGERED, (payload = {}) => {
    const encounterId = payload.encounterId ?? payload.sceneData?.encounterId;

    if (!encounterId) {
      eventBus.emit(EVENTS.UI_NOTIFICATION, {
        text: "Nem indítható a harc (hiányzó encounterId).",
        type: "error",
        ttl: 4500,
      });

      eventBus.emit(EVENTS.COMBAT_ENDED, {
        result: "error",
        reason: "Missing encounterId in COMBAT_TRIGGERED payload.",
      });
      return;
    }

    const started = startStaticEncounter(encounterId);
    if (started) return;

    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: `Nem indítható a harc (${encounterId ?? "unknown"}).`,
      type: "error",
      ttl: 4500,
    });

    eventBus.emit(EVENTS.COMBAT_ENDED, {
      result: "error",
      reason: `Encounter indítása sikertelen: ${encounterId}`,
      encounterId,
    });
  });

  initDiceBoxUI();
  initDiceUI();

  // ── Step 8: Resume saved game or greet the new character ────────────────────
  if (menuResult.resumeSave) {
    // Player clicked "Continue Saved Adventure" — load from storage.
    const loaded = loadGame();
    if (!loaded.ok) {
      // Fallback: save is corrupted / missing — show full character creation.
      await showCharacterCreation();
    } else {
      appendNarration(
        `Welcome back, ${gameStore.getState().player.name}! Your adventure continues…`,
        "system",
      );
    }
  }
  // New-game path: player data is already in the store from Step 4 above.
  // initMana() and initEquipment() (called below) will layer on spells / bonuses.

  // Enable autosave now that a character exists
  enableAutosave();

  // Initialise mana for classes with spellcasting ability
  // (no-op for non-casters and for saves that already have mana data)
  initMana();

  // Snapshot base stats and apply any already-equipped item bonuses
  // (no-op if base stats already set — safe for loaded saves)
  initEquipment();

  // Auto-equip all equippable starting items for new games
  if (!menuResult.resumeSave) {
    gameStore.getState().player.inventory.forEach(({ itemId }) => {
      if (isEquippable(itemId)) autoEquipItem(itemId);
    });
  }

  // Wire the level-up stat-choice modal (listens for LEVEL_UP_READY)
  initLevelUpUI();

  // Wire the merchant/shop modal (listens for OPEN_SHOP)
  initMerchantUI();

  // Wire the free-text action input (replaces static wireUI input handling)
  initActionInput();

  // Wire the tactical grid map (mounts on COMBAT_STARTED, unmounts on COMBAT_ENDED)
  initCombatMap();

  // ── New UI components ──────────────────────────────────────────────────────
  // Rank Progression Modal (attaches click handler to #rank-btn)
  initRankModal();
  // Changelog Modal (attaches to #changelog-btn)
  initChangelog();
  // How To Play Accordion (renders into #how-to-play-panel inside modal)
  initHowToPlayAccordion(document.querySelector("#how-to-play-panel"));
  // Stats Radar Chart (renders into #radar-chart-slot inside modal)
  mountRadarChart(document.querySelector("#radar-chart-slot"));

  // Step 5: Start story engine
  if (_isDemoCampaignEnabled()) {
    campaignManager.loadCampaign(demoCampaign);
    campaignManager.goToScene("start");
  } else {
    startStory();
  }
}

function _isDemoCampaignEnabled() {
  const raw = String(import.meta.env.VITE_USE_DEMO_CAMPAIGN ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

// ── Character Creation ────────────────────────────────────────────────────────

/** Returns a Promise that resolves when the player confirms their character */
function showCharacterCreation() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "creation-mount";
    document.body.appendChild(overlay);

    mountCharacterCreation(overlay, () => {
      overlay.remove();
      resolve();
    });
  });
}

// ── UI ────────────────────────────────────────────────────────────────────────

function renderUI(app, campaign) {
  app.innerHTML = `
    <div class="game-layout">
      <header class="game-header">
        <h1 class="campaign-title">${campaign.meta.title}</h1>
        <div class="header-actions">
          <button id="btn-inventory"  class="icon-btn" title="Inventory (I)">⚔️</button>
          <button id="btn-character"  class="icon-btn" title="Character (C)">📋</button>
          <button id="btn-quests"     class="icon-btn" title="Quest Log (Q)">📜</button>
          <button id="btn-encounters" class="icon-btn" title="Encounters (E)">🗡️</button>
          <button id="btn-session"    class="icon-btn" title="Co-op Session">🌐</button>
          <button id="btn-radar"      class="icon-btn" title="Képességek Radar">📊</button>
          <button id="rank-btn"       class="icon-btn" title="Rang és Haladás">👑</button>
          <button id="how-to-play-btn" class="icon-btn" title="Hogyan játssz?">❓</button>
          <button id="changelog-btn"  class="icon-btn" title="Változásnapló">📋</button>
          <button id="btn-save"       class="icon-btn" title="Save / Load (F5)">💾</button>
          <button id="btn-settings"   class="icon-btn" title="Settings">⚙️</button>
        </div>
      </header>

      <main class="game-main">
        <div class="narrative-log" id="narrative-log"></div>
        <section class="chronicle-panel log-panel">
          <h3>Krónika</h3>
          <div id="chronicle-log" class="scrollable-log"></div>
        </section>
        <div class="runtime-log-grid">
          <div class="log-panel">
            <h3>Harc Napló</h3>
            <div id="combat-log" class="scrollable-log"></div>
          </div>
          <div class="log-panel">
            <h3>Rendszer Napló (Debug)</h3>
            <div id="system-log" class="scrollable-log"></div>
          </div>
        </div>
      </main>

      <!-- 3D dice canvas — positioned fixed, shown only during rolls -->
      <div id="dice-click-overlay" class="hidden" aria-live="polite">
        <div id="dice-click-box" class="dice-box" data-side="1">?</div>
        <div id="dice-click-instructions" class="dice-instructions">Kattints a kockára a dobáshoz!</div>
      </div>

      <footer class="game-footer">
        <div class="action-bar" id="action-bar"></div>
        <div class="input-row">
          <input
            id="player-input"
            class="player-input"
            type="text"
            placeholder="What do you do?"
            autocomplete="off"
          />
          <button id="btn-send" class="btn-send">▶</button>
        </div>
      </footer>
    </div>

    <!-- Settings Modal -->
    <div class="modal-overlay hidden" id="modal-key">
      <div class="modal settings-modal">
        <h2>⚙️ Settings</h2>

        <!-- Language -->
        <div class="settings-section">
          <h3 class="settings-section-title">🌍 Language / Nyelv</h3>
          <select id="lang-select" class="key-input" style="padding:.45rem .6rem">
            <option value="hu">🇭🇺 Magyar</option>
            <option value="en">🇬🇧 English</option>
          </select>
        </div>

        <div class="modal-actions">
          <button id="btn-save-key" class="btn-primary">Save &amp; Close</button>
          <button id="btn-close-settings" class="btn-secondary">Close</button>
        </div>
      </div>
    </div>

    <!-- Save / Load Modal -->
    <div class="modal-overlay hidden" id="modal-save">
      <div class="modal save-modal">
        <h2>Save &amp; Load</h2>
        <div id="save-slot-list" class="save-slot-list"></div>
        <div class="modal-actions save-modal-actions">
          <button id="btn-do-save"   class="btn-primary">💾 Save Now</button>
          <button id="btn-export"    class="btn-secondary">⬇ Export</button>
          <button id="btn-import"    class="btn-secondary">⬆ Import</button>
          <button id="btn-close-save-modal" class="btn-secondary">✕ Close</button>
        </div>
      </div>
    </div>

    <!-- Encounter Picker Modal -->
    <div class="modal-overlay hidden" id="modal-encounters" role="dialog" aria-modal="true" aria-label="Encounters">
      <div class="modal encounter-modal">
        <div class="modal-header">
          <h2>⚔️ Encounters</h2>
          <button id="btn-close-encounters" class="cs-close" title="Close">✕</button>
        </div>
        <p class="enc-hint">Pick an encounter to test combat without the AI. Difficulty scales from Trivial to Deadly.</p>
        <div id="encounter-list" class="encounter-list"></div>
      </div>
    </div>

    <!-- Game Over Modal -->
    <div class="modal-overlay hidden" id="modal-game-over" role="dialog" aria-modal="true" aria-label="Game Over">
      <div class="modal game-over-modal">
        <h2 class="game-over-title">💀 You Have Died</h2>
        <p class="game-over-sub">Your adventure ends here… for now.</p>
        <div class="modal-actions">
          <button id="btn-go-load"    class="btn-primary">💾 Load Last Save</button>
          <button id="btn-go-newgame" class="btn-secondary">⚔️ New Character</button>
        </div>
      </div>
    </div>

    <!-- Notification toasts -->
    <div id="notif-container" aria-live="polite"></div>

    <!-- Radar Chart Modal -->
    <div class="modal-overlay hidden" id="modal-radar" role="dialog" aria-modal="true" aria-label="Képességek Radar">
      <div class="modal radar-modal">
        <div class="modal-header">
          <h2>📊 Képességek</h2>
          <button id="btn-close-radar" class="cs-close" title="Bezárás">✕</button>
        </div>
        <div id="radar-chart-slot"></div>
      </div>
    </div>

    <!-- How To Play Modal -->
    <div class="modal-overlay hidden" id="modal-how-to-play" role="dialog" aria-modal="true" aria-label="Hogyan játssz?">
      <div class="modal htp-modal">
        <div class="modal-header">
          <h2>❓ Hogyan játssz?</h2>
          <button id="btn-close-htp" class="cs-close" title="Bezárás">✕</button>
        </div>
        <div id="how-to-play-panel" style="max-height:70vh;overflow-y:auto;padding:4px 2px"></div>
      </div>
    </div>
  `;
}

function wireUI() {
  // NOTE: #player-input and #btn-send are now managed by ActionInputUI.
  // initActionInput() (called in bootstrap) wires submission and loading state.

  document
    .querySelector("#btn-settings")
    .addEventListener("click", showKeyModal);

  document
    .querySelector("#btn-inventory")
    ?.addEventListener("click", toggleInventory);

  document
    .querySelector("#btn-character")
    ?.addEventListener("click", toggleCharacterSheet);

  document.querySelector("#btn-save")?.addEventListener("click", showSaveModal);

  document.querySelector("#btn-do-save")?.addEventListener("click", () => {
    saveGame();
    renderSaveSlots();
  });

  document.querySelector("#btn-export")?.addEventListener("click", exportSave);

  document.querySelector("#btn-import")?.addEventListener("click", async () => {
    const result = await importSave();
    if (result.ok) {
      closeSaveModal();
      appendNarration(
        `Imported save for ${result.meta?.playerName ?? "unknown"}`,
        "system",
      );
    }
  });

  document
    .querySelector("#btn-close-save-modal")
    ?.addEventListener("click", closeSaveModal);

  document.querySelector("#btn-save-key").addEventListener("click", () => {
    // ── Language ────────────────────────────────────────────────
    const lang = document.querySelector("#lang-select")?.value ?? "hu";
    localStorage.setItem("dnd_lang", lang);
    const curSettings = gameStore.getState().settings ?? {};
    gameStore.setState(
      { settings: { ...curSettings, language: lang } },
      "main:setLanguage",
    );

    closeKeyModal();
    appendNarration("Settings saved.", "system");
  });

  document
    .querySelector("#btn-close-settings")
    ?.addEventListener("click", () => {
      closeKeyModal();
    });

  document.querySelector("#modal-key")?.addEventListener("click", (e) => {
    if (e.target === document.querySelector("#modal-key")) {
      closeKeyModal();
    }
  });

  // Sync language selector when the modal opens
  document.querySelector("#btn-settings")?.addEventListener("click", () => {
    const langSelect = document.querySelector("#lang-select");
    if (langSelect) {
      langSelect.value = gameStore.getState().settings?.language ?? "hu";
    }
  });

  document
    .querySelector("#btn-quests")
    ?.addEventListener("click", toggleQuestLog);

  // Radar chart modal
  document
    .querySelector("#btn-radar")
    ?.addEventListener("click", () =>
      document.querySelector("#modal-radar")?.classList.remove("hidden"),
    );
  document
    .querySelector("#btn-close-radar")
    ?.addEventListener("click", () =>
      document.querySelector("#modal-radar")?.classList.add("hidden"),
    );
  document.querySelector("#modal-radar")?.addEventListener("click", (e) => {
    if (e.target === document.querySelector("#modal-radar"))
      document.querySelector("#modal-radar")?.classList.add("hidden");
  });

  // How To Play modal
  document
    .querySelector("#how-to-play-btn")
    ?.addEventListener("click", () =>
      document.querySelector("#modal-how-to-play")?.classList.remove("hidden"),
    );
  document
    .querySelector("#btn-close-htp")
    ?.addEventListener("click", () =>
      document.querySelector("#modal-how-to-play")?.classList.add("hidden"),
    );
  document
    .querySelector("#modal-how-to-play")
    ?.addEventListener("click", (e) => {
      if (e.target === document.querySelector("#modal-how-to-play"))
        document.querySelector("#modal-how-to-play")?.classList.add("hidden");
    });

  document
    .querySelector("#btn-encounters")
    ?.addEventListener("click", showEncounterModal);

  document
    .querySelector("#btn-close-encounters")
    ?.addEventListener("click", closeEncounterModal);

  // Game Over modal
  document.querySelector("#btn-go-load")?.addEventListener("click", () => {
    const result = loadGame();
    closeGameOverModal();
    if (result.ok) {
      appendNarration(
        `Loaded save for ${result.meta?.playerName ?? "your character"}. The adventure continues…`,
        "system",
      );
    } else {
      appendNarration("No save found. Starting fresh.", "system");
      window.location.reload();
    }
  });

  document.querySelector("#btn-go-newgame")?.addEventListener("click", () => {
    // Reload to clear all runtime state cleanly
    window.location.reload();
  });

  document
    .querySelector("#btn-session")
    ?.addEventListener("click", toggleSessionPanel);

  // ── Keyboard shortcuts ───────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA";

    if (e.key === "Escape") {
      closeAllPanels();
      return;
    }
    if (typing) return;

    if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      toggleInventory();
    }
    if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      toggleCharacterSheet();
    }
    if (e.key === "q" || e.key === "Q") {
      e.preventDefault();
      toggleQuestLog();
    }
    if (e.key === "/") {
      e.preventDefault();
      document.querySelector("#player-input")?.focus();
    }
    if (e.key === "F5") {
      e.preventDefault();
      saveGame();
    }
    if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      toggleEncounterModal();
    }
  });
}

function closeAllPanels() {
  closeQuestLog();
  closeCharacterSheet();
  closeInventory();
  closeEncounterModal();
  document.querySelector("#modal-key")?.classList.add("hidden");
  document.querySelector("#modal-save")?.classList.add("hidden");
  document.querySelector("#session-panel")?.classList.add("hidden");
  document.querySelector("#modal-radar")?.classList.add("hidden");
  document.querySelector("#modal-how-to-play")?.classList.add("hidden");
  // Game-over modal is intentionally NOT closed by Escape
}

function showGameOverModal() {
  const modal = document.querySelector("#modal-game-over");
  if (!modal) return;
  // Render available save info on the Load button
  if (!hasSavedGame()) {
    const loadBtn = modal.querySelector("#btn-go-load");
    if (loadBtn) loadBtn.disabled = true;
  }
  modal.classList.remove("hidden");
}
function closeGameOverModal() {
  document.querySelector("#modal-game-over")?.classList.add("hidden");
}

function showEncounterModal() {
  renderEncounterList();
  document.querySelector("#modal-encounters")?.classList.remove("hidden");
}
function closeEncounterModal() {
  document.querySelector("#modal-encounters")?.classList.add("hidden");
}
function toggleEncounterModal() {
  const modal = document.querySelector("#modal-encounters");
  if (!modal) return;
  modal.classList.contains("hidden")
    ? showEncounterModal()
    : closeEncounterModal();
}

function renderEncounterList() {
  const list = document.querySelector("#encounter-list");
  if (!list) return;

  const encounters = listEncounters();
  list.innerHTML = encounters
    .map((enc) => {
      const colour = DIFFICULTY_COLOUR[enc.difficulty] ?? "#6b7280";
      const enemyCount = enc.enemies.length;
      const totalXP = enc.enemies.reduce((s, e) => s + (e.xpReward ?? 0), 0);
      return `
        <div class="enc-card" data-id="${enc.id}">
          <div class="enc-card-header">
            <span class="enc-name">${enc.name}</span>
            <span class="enc-difficulty" style="color:${colour}">${enc.difficulty}</span>
          </div>
          <p class="enc-desc">${enc.description}</p>
          <div class="enc-meta">
            <span>${enemyCount} enem${enemyCount === 1 ? "y" : "ies"}</span>
            <span>${totalXP} XP</span>
          </div>
          <button class="btn-primary enc-start-btn" data-id="${enc.id}">▶ Start</button>
        </div>`;
    })
    .join("");

  list.querySelectorAll(".enc-start-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ok = startStaticEncounter(btn.dataset.id);
      if (ok) closeEncounterModal();
    });
  });
}

function subscribeToStore() {
  // Action buttons
  gameStore.select((s) => s.world.availableActions, renderActionBar);

  // Pending / loading state
  gameStore.select(
    (s) => s.dm.pendingResponse,
    (pending) => {
      // btn-send and player-input are now managed by ActionInputUI;
      // we just handle the "thinking…" narrative indicator here.
      const existing = document.querySelector(".narrative-dm-thinking");
      if (pending && !existing) appendNarration("…", "dm-thinking");
      if (!pending && existing) existing.remove();

      // Also disable/enable action bar buttons to prevent double-submit
      document
        .querySelectorAll("#action-bar .action-btn")
        .forEach((b) => (b.disabled = pending));
    },
  );

  // Narrative log updates — mirror both DM narration and player actions.
  // ActionInputUI emits PLAYER_CUSTOM_ACTION → processTurn logs the player
  // entry in the store → this watcher renders it.
  gameStore.select(
    (s) => s.dm.narrativeLog.length,
    (_, state) => {
      const last = state.dm.narrativeLog.at(-1);
      if (last?.role === "dm" || last?.role === "player") {
        appendNarration(last.text, last.role);
      }
    },
  );

  // UI Notifications
  eventBus.on(EVENTS.UI_NOTIFICATION, ({ text, type = "info", ttl = 3000 }) => {
    showNotification(text, type, ttl);
  });

  eventBus.on(EVENTS.NARRATIVE_UPDATE, ({ text, role = "dm" } = {}) => {
    if (!text) return;
    appendNarration(text, role);
  });

  // Game Over — player died
  eventBus.on(EVENTS.COMBAT_DEFEAT, () => {
    showGameOverModal();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function appendNarration(text, role) {
  const log = document.querySelector("#narrative-log");
  if (!log) {
    if (!appendNarration._missingContainerWarned) {
      appendNarration._missingContainerWarned = true;
      console.error(
        "[UI] A #narrative-log elem hiányzik, ezért a narráció nem jeleníthető meg.",
      );
    }
    return;
  }

  const el = document.createElement("p");
  el.className = `narrative-entry narrative-${role}`;
  el.dataset.role = role;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function renderActionBar(actions = []) {
  const bar = document.querySelector("#action-bar");
  if (!bar) return;

  bar.innerHTML = (actions ?? [])
    .map(
      (action) =>
        `<button class="action-btn" data-action="${action}">${action}</button>`,
    )
    .join("");

  bar.querySelectorAll(".action-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (gameStore.getState().dm.pendingResponse) return;
      const text = btn.dataset.action;
      bar.querySelectorAll(".action-btn").forEach((b) => (b.disabled = true));
      await processTurn(text);
    });
  });
}

function showKeyModal() {
  document.querySelector("#modal-key")?.classList.remove("hidden");
}
function closeKeyModal() {
  document.querySelector("#modal-key")?.classList.add("hidden");
}

function showSaveModal() {
  renderSaveSlots();
  document.querySelector("#modal-save")?.classList.remove("hidden");
}
function closeSaveModal() {
  document.querySelector("#modal-save")?.classList.add("hidden");
}

function renderSaveSlots() {
  const list = document.querySelector("#save-slot-list");
  if (!list) return;
  const slots = listSaves();
  if (slots.length === 0) {
    list.innerHTML = `<p class="save-slot-empty">No saves found.</p>`;
    return;
  }
  list.innerHTML = slots
    .map(({ slotId, meta }) => {
      const date = meta?.savedAt
        ? new Date(meta.savedAt).toLocaleString()
        : "Unknown date";
      const label = meta
        ? `${meta.playerName} · Lv ${meta.level} ${meta.class} · ${date}`
        : slotId;
      return `
      <div class="save-slot">
        <div class="save-slot-info">
          <span class="save-slot-label">${label}</span>
        </div>
        <div class="save-slot-actions">
          <button class="inv-btn" data-load="${slotId}">Load</button>
          <button class="inv-btn inv-btn--drop" data-del="${slotId}">Delete</button>
        </div>
      </div>`;
    })
    .join("");

  list.querySelectorAll("[data-load]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = loadGame(btn.dataset.load);
      if (result.ok) {
        closeSaveModal();
        appendNarration(
          `Loaded: ${result.meta?.playerName} Lv${result.meta?.level}`,
          "system",
        );
      }
    });
  });
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      deleteSave(btn.dataset.del);
      renderSaveSlots();
    });
  });
}

let _notifId = 0;
function showNotification(text, type = "info", ttl = 3000) {
  const container = document.querySelector("#notif-container");
  if (!container) return;
  const id = ++_notifId;
  const el = document.createElement("div");
  el.className = `notif notif--${type}`;
  el.id = `notif-${id}`;
  el.textContent = text;
  container.appendChild(el);
  // Trigger animation on next frame
  requestAnimationFrame(() => el.classList.add("notif--visible"));
  setTimeout(() => {
    el.classList.remove("notif--visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, ttl);
}

function renderFatalScreen(title, error) {
  const app = document.querySelector("#app");
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);

  const wrapper = document.createElement("div");
  wrapper.className = "error";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const details = document.createElement("pre");
  details.textContent = message;

  wrapper.appendChild(heading);
  wrapper.appendChild(details);

  if (app) {
    app.innerHTML = "";
    app.appendChild(wrapper);
    return;
  }

  document.body.innerHTML = "";
  document.body.appendChild(wrapper);
}

// ── Go ────────────────────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  console.error("[Bootstrap] Fatal:", err);
  renderFatalScreen("Engine failed to start", err);
});
