/**
 * CombatUI.js
 *
 * Renders the combat HUD: turn order strip, enemy cards, combat log,
 * and action buttons (Attack, Dodge, Dash, Use Item, End Turn).
 *
 * Subscribes to store slices — re-renders automatically when state changes.
 * Appears over the main layout when combat.active is true.
 * Disappears when combat.active returns to false.
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";
import {
  performAttack,
  collectVictoryRewards,
} from "../../engine/actionDispatcher.js";
import { toggleInventory } from "./InventoryPanel.js";
import {
  advanceTurn,
  runEnemyTurn,
  endCombat,
  calcDistance,
  applyDamage,
} from "../../systems/turnManager.js";
import { roll } from "../../systems/diceSystem.js";
import { processTurn } from "../../systems/dmController.js";
import { EQUIPMENT_TEMPLATES } from "../../data/equipment.js";
import { SPELLS } from "../../data/spells.js";
import { castSpell } from "../../systems/spellSystem.js";

// ── Cantrip / free ranged attack for spellcaster classes ──────────────────────
// When a spellcaster has no physical ranged weapon equipped they use a free
// cantrip bolt that requires NO mana and NO ammo.
// Spellcasting ability follows D&D 5e convention.
const SPELLCASTER_CANTRIP = {
  Wizard: {
    name: "Tűzlövedék",
    icon: "🔥",
    die: 10,
    abilityKey: "int",
    range: 12,
  },
  Sorcerer: {
    name: "Tűzlövedék",
    icon: "🔥",
    die: 10,
    abilityKey: "cha",
    range: 12,
  },
  Warlock: {
    name: "Ördögi Csapás",
    icon: "💜",
    die: 10,
    abilityKey: "cha",
    range: 12,
  },
  Bard: {
    name: "Fénylövedék",
    icon: "✨",
    die: 8,
    abilityKey: "cha",
    range: 10,
  },
  Cleric: {
    name: "Isteni Láng",
    icon: "☀️",
    die: 8,
    abilityKey: "wis",
    range: 8,
  },
  Druid: {
    name: "Manaszikra",
    icon: "🌿",
    die: 8,
    abilityKey: "wis",
    range: 8,
  },
};

/**
 * Returns the cantrip meta for the player's class if they are a spellcaster
 * and do NOT have a physical ranged weapon (bow/crossbow) equipped.
 * Returns null otherwise (use normal weapon logic).
 *
 * @param {object} player
 * @param {boolean} [hasPhysicalRanged=false]
 * @returns {{ name, icon, die, abilityKey, range } | null}
 */
function _getCantripData(player, hasPhysicalRanged = false) {
  if (hasPhysicalRanged) return null;
  return SPELLCASTER_CANTRIP[player?.class ?? ""] ?? null;
}
import { removeItem } from "../../systems/inventorySystem.js";

let _unsubs = []; // Store unsubscribe functions for cleanup

/** Defeated enemies from the last combat — used to give the DM rich context. */
let _lastDefeated = [];

/**
 * Persists the targeted enemy ID across DOM re-renders.
 * renderEnemyCards() rebuilds innerHTML on every state change, so the
 * CSS class 'enemy-card--targeted' would be wiped each time.
 * Storing the ID here lets us restore the visual selection after each render.
 */
let _targetedEnemyId = null;

/**
 * DM narration label built by COMBAT_ENDED for the victory case.
 * We DON'T call processTurn immediately — we wait until the player
 * dismisses the victory modal so the DM response appears after they
 * click "Continue", not while the modal is still covering the screen.
 */
let _pendingDmLabel = null;

/**
 * Tracks whose turn it is based on COMBAT_TURN_START events.
 * More reliable than reading turnOrder[currentTurnIndex] because advanceTurn()
 * stores currentTurnIndex as an index into the *alive* array while turnOrder
 * in state still contains dead combatants — making direct index lookup wrong.
 */
let _currentTurnIsPlayer = false;

// ── Mount / Unmount ───────────────────────────────────────────────────────────

/**
 * Initialise the combat UI system.
 * Listens for COMBAT_STARTED to mount, COMBAT_ENDED to unmount.
 * Call once during bootstrap.
 */
export function initCombatUI() {
  eventBus.on(EVENTS.COMBAT_STARTED, () => {
    console.log("[CombatUI] COMBAT_STARTED received — mounting HUD");
    mountCombatHUD();
  });

  // Auto-run enemy turns when it's not the player's turn
  eventBus.on(EVENTS.COMBAT_TURN_START, async ({ current, stunned }) => {
    _currentTurnIsPlayer = current?.isPlayer ?? false;

    // On the player's turn: tick Barbarian Rage countdown + reset per-turn flags
    if (current?.isPlayer) {
      // ── Death save guard — skip ALL normal turn processing when unconscious ──
      // Re-arm the death save button and bail out immediately.
      // This prevents Wild Shape regen, class-ability resets, etc. from
      // firing while the player is at 0 HP.
      if (gameStore.getState().player.deathSaveActive) {
        const dsBtn = document.querySelector("#ds-roll-btn");
        if (dsBtn) dsBtn.disabled = false;
        return;
      }

      // ── Clear per-turn status flags ────────────────────────────────────
      {
        const stClear = gameStore.getState();
        // Clear dodge flag set last turn so enemies no longer suffer disadvantage
        if (stClear.player.dodging) {
          gameStore.setState(
            { player: { ...stClear.player, dodging: false } },
            "combatUI:clearDodge",
          );
        }
      }
      // Re-arm death save button when the player's turn comes around
      const dsBtn = document.querySelector("#ds-roll-btn");
      if (dsBtn) dsBtn.disabled = false;

      const st = gameStore.getState();
      const ca = st.player.classAbilities ?? {};

      // Reset per-turn flags
      const needsReset =
        ca.extraAttackUsedThisTurn ||
        !ca.reactionAvailable ||
        (ca.offhandUsed ?? false);
      const rageUpdate = (() => {
        if (!ca.rageActive || ca.rageRoundsLeft <= 0) return {};
        const newRounds = ca.rageRoundsLeft - 1;
        return { rageActive: newRounds > 0, rageRoundsLeft: newRounds };
      })();
      const rageDied =
        ca.rageActive && (rageUpdate.rageRoundsLeft ?? ca.rageRoundsLeft) <= 0;

      if (needsReset || Object.keys(rageUpdate).length) {
        gameStore.setState(
          {
            player: {
              ...st.player,
              classAbilities: {
                ...ca,
                ...rageUpdate,
                reactionAvailable: true,
                extraAttackUsedThisTurn: false,
                offhandUsed: false,
              },
            },
          },
          "combatUI:turnStartReset",
        );
        if (rageDied) {
          appendCombatLog("🪓 Rage has ended — the red haze fades.");
        }
        _refreshClassButton();
      } else if (ca.rageActive && ca.rageRoundsLeft > 0) {
        // Legacy path: just tick rage if nothing else needs resetting
        const newRounds = ca.rageRoundsLeft - 1;
        const stillRaging = newRounds > 0;
        gameStore.setState(
          {
            player: {
              ...st.player,
              classAbilities: {
                ...ca,
                rageActive: stillRaging,
                rageRoundsLeft: newRounds,
              },
            },
          },
          "combatUI:rageTick",
        );
        if (!stillRaging) {
          appendCombatLog("🪓 Rage has ended — the red haze fades.");
        }
        _refreshClassButton();
      }

      // ── Wild Shape: HP regen + round countdown ──────────────────────────────────
      const wsPlayer = gameStore.getState().player;
      const wsCa = wsPlayer.classAbilities ?? {};
      if (wsCa.wildShapeActive && (wsCa.wildShapeRoundsLeft ?? 0) > 0) {
        const newWsRounds = wsCa.wildShapeRoundsLeft - 1;
        const wsExpired = newWsRounds <= 0;
        const wsHp = Math.min(wsPlayer.maxHp, (wsPlayer.hp ?? 0) + 1);
        const wsAcPatch = wsExpired ? { ac: (wsPlayer.ac ?? 10) - 2 } : {};
        gameStore.setState(
          {
            player: {
              ...wsPlayer,
              hp: wsHp,
              ...wsAcPatch,
              classAbilities: {
                ...wsCa,
                wildShapeActive: !wsExpired,
                wildShapeRoundsLeft: newWsRounds,
              },
            },
          },
          "combatUI:wildShapeTick",
        );
        if (wsExpired) {
          appendCombatLog(
            "\uD83D\uDC3B Wild Shape ended — back to humanoid form. (-2 AC)",
          );
          _refreshClassButton();
        } else {
          appendCombatLog(
            `\uD83D\uDC3B Wild Shape: +1 HP regenerated (${newWsRounds} round${newWsRounds === 1 ? "" : "s"} left).`,
          );
        }
      }
      return;
    }
    if (!current || stunned) return;

    // Pull the full enemy template from campaign data for proper stats
    const state = gameStore.getState();
    const template = state.campaign.enemies[current.enemyType ?? ""] ?? {};
    const enemyWithStats = { ...template, ...current };

    // Bug fix: catch any unhandled rejection so a crashed enemy turn doesn't
    // freeze combat with all buttons permanently disabled.
    try {
      await runEnemyTurn(enemyWithStats);
    } catch (err) {
      console.error("[CombatUI] Enemy turn threw — forcing advanceTurn:", err);
      advanceTurn();
    }
  });

  // After combat resolves, ask the DM to narrate the aftermath
  eventBus.on(EVENTS.COMBAT_ENDED, async ({ outcome }) => {
    // Clean up death save overlay if it is still open (defeat case)
    document.querySelector("#death-save-overlay")?.remove();

    _targetedEnemyId = null; // Reset target on combat end
    unmountCombatHUD();

    // Always clear death-save state when combat ends so it never bleeds
    // into the next encounter (victory path didn't reset it before).
    {
      const st = gameStore.getState();
      const needsReset =
        st.player.deathSaveActive ||
        (st.player.deathSaves?.successes ?? 0) > 0 ||
        (st.player.deathSaves?.failures ?? 0) > 0 ||
        (st.player.conditions ?? []).includes("unconscious");
      if (needsReset || outcome === "defeat") {
        gameStore.setState(
          {
            player: {
              ...st.player,
              hp: outcome === "defeat" ? 1 : st.player.hp,
              deathSaveActive: false,
              deathSaves: { successes: 0, failures: 0 },
              conditions: (st.player.conditions ?? []).filter(
                (c) => c !== "unconscious",
              ),
            },
          },
          "combatUI:clearDeathSaveOnCombatEnd",
        );
      }
    }

    // Build a rich context string for the DM so it knows who died and the player's HP
    // _lastDefeated is filled by the COMBAT_VICTORY handler (fires before this await)
    const state = gameStore.getState();
    const hpStatus = `${state.player.hp}/${state.player.maxHp} HP`;
    const enemyNames = _lastDefeated.map((e) => e.name).join(", ");

    const label =
      outcome === "victory"
        ? `The combat is over. I stand victorious${
            enemyNames ? `, having defeated ${enemyNames}` : ""
          }. I have ${hpStatus} remaining.`
        : `I have been defeated and fall unconscious at 0 HP.`;

    // Reset for next combat
    _lastDefeated = [];

    if (outcome === "victory") {
      // Store label — the victory modal's "Continue" button will trigger DM narration
      // so the response appears AFTER the player dismisses the modal, not behind it.
      _pendingDmLabel = label;
    } else {
      // Defeat: no modal, narrate directly after a short delay
      await new Promise((r) => setTimeout(r, 500));
      await processTurn(label);
    }
  });

  // Show death save UI when the player hits 0 HP
  eventBus.on(EVENTS.PLAYER_KNOCKED_OUT, ({ playerName }) => {
    _mountDeathSaveUI(playerName);
  });

  // Opportunity Attack: enemy moved away — offer reaction attack
  eventBus.on(EVENTS.OPPORTUNITY_ATTACK, ({ enemyId, enemyName }) => {
    const st = gameStore.getState();
    if (!st.combat?.active) return;
    if (!st.player.classAbilities?.reactionAvailable) return;
    _showOppAttackPrompt(enemyId, enemyName);
  });

  // Victory: collect rewards, capture defeated list for DM context, show modal
  eventBus.on(EVENTS.COMBAT_VICTORY, ({ defeated = [] }) => {
    _lastDefeated = defeated; // captured before COMBAT_ENDED async continuation runs
    const rewards = collectVictoryRewards(defeated);
    _mountVictoryModal(rewards);
  });

  // ── Floating Combat Text (FCT) ───────────────────────────────────────────
  eventBus.on(EVENTS.COMBATANT_DAMAGED, ({ targetId, damage, isCrit }) => {
    _spawnFCT(
      `#enemy-cards [data-enemy-id="${targetId}"]`,
      `-${damage}`,
      isCrit ? "crit" : "damage",
    );
    if (isCrit || damage >= 10) _shakeHUD();
  });

  eventBus.on(EVENTS.PLAYER_DAMAGED, ({ damage, crit }) => {
    _spawnFCT("#player-combat-bar", `-${damage}`, crit ? "crit" : "damage");
    if (crit || damage >= 10) _shakeHUD();
  });

  eventBus.on(EVENTS.STATUS_EFFECT_TICKED, ({ targetId, delta }) => {
    if (delta === 0) return; // stun — no number to float
    const st = gameStore.getState();
    const isPlayer =
      st.combat.turnOrder.find((p) => p.id === targetId)?.isPlayer ?? false;
    const sel = isPlayer
      ? "#player-combat-bar"
      : `#enemy-cards [data-enemy-id="${targetId}"]`;
    const text = delta > 0 ? `+${delta}` : `${delta}`;
    const type = delta > 0 ? "heal" : "poison";
    _spawnFCT(sel, text, type);
  });
}

// ── VFX & Status-Effect Helpers ───────────────────────────────────────────

/**
 * Generate the class-specific ability button HTML for the HUD.
 * Returns empty string for classes with no defined special action.
 * @param {Object} player
 */
function _classAbilityHtml(player) {
  const cls = player?.class ?? "";
  const ca = player?.classAbilities ?? {};
  switch (cls) {
    case "Fighter":
      return `<button class="combat-btn combat-btn--class" id="cbtn-class" title="Regain 1d10 + level HP (1/short rest)"${ca.secondWindUsed ? " disabled" : ""}>💨 Second Wind</button>`;
    case "Barbarian": {
      const rageLabel = ca.rageActive
        ? "🔥 Raging!"
        : `🪓 Rage (${ca.rageUses ?? 2} left)`;
      const rageDisabled = !ca.rageActive && (ca.rageUses ?? 2) <= 0;
      return `<button class="combat-btn combat-btn--class${ca.rageActive ? " combat-btn--class-active" : ""}" id="cbtn-class" title="Rage: +2 damage, resistance to physical damage (3 rounds)"${rageDisabled ? " disabled" : ""}>${rageLabel}</button>`;
    }
    case "Rogue":
      return `<button class="combat-btn combat-btn--class" id="cbtn-class" title="Sneak Attack: +${Math.ceil((player.level ?? 1) / 2)}d6 damage on next attack (need advantage or adjacent ally)">🗡️ Sneak Atk</button>`;
    case "Monk": {
      const ki = ca.kiPoints ?? 0;
      return `<button class="combat-btn combat-btn--class" id="cbtn-class" title="Spend 1 Ki Point: make a bonus unarmed strike" ${ki <= 0 ? "disabled" : ""}>🥋 Flurry (${ki} ki)</button>`;
    }
    case "Paladin": {
      const smiteLabel = ca.smitePending
        ? "⚡ Smite Ready!"
        : "⚡ Divine Smite";
      return `<button class="combat-btn combat-btn--class${ca.smitePending ? " combat-btn--class-active" : ""}" id="cbtn-class" title="Divine Smite: arm +2d8 radiant on your next hit">${smiteLabel}</button>`;
    }
    case "Ranger": {
      const markLabel = ca.hunterMarkTarget
        ? "🎯 Mark Active!"
        : "🎯 Hunter's Mark";
      return `<button class="combat-btn combat-btn--class${ca.hunterMarkTarget ? " combat-btn--class-active" : ""}" id="cbtn-class" title="Hunter's Mark: target an enemy for +1d6 damage on hits (Concentration)">${markLabel}</button>`;
    }
    case "Bard": {
      const inspLabel = ca.bardInspirationUsed
        ? "🎵 Inspiration (used)"
        : `🎵 Inspiration (d${ca.bardBonusDie || 6})`;
      return `<button class="combat-btn combat-btn--class" id="cbtn-class" ${ca.bardInspirationUsed ? "disabled" : ""} title="Bardic Inspiration: +1d6 bonus to your next attack roll">${inspLabel}</button>`;
    }
    case "Sorcerer": {
      const surges = ca.sorcerySurgesLeft ?? 2;
      return `<button class="combat-btn combat-btn--class" id="cbtn-class" ${surges <= 0 ? "disabled" : ""} title="Sorcery Surge: spend 2 MP to deal 1d6 magic damage to ALL enemies">✨ Sorcery Surge (${surges})</button>`;
    }
    case "Cleric":
      return `<button class="combat-btn combat-btn--class" id="cbtn-class" title="Sacred Flame: 1d8+WIS radiant damage, no MP cost">🌟 Sacred Flame</button>`;
    case "Druid": {
      const wildActive = ca.wildShapeActive ?? false;
      return `<button class="combat-btn combat-btn--class${wildActive ? " combat-btn--class-active" : ""}" id="cbtn-class" title="Wild Shape: +2 AC, regenerate 1 HP/turn for 3 rounds">${wildActive ? "🐻 Wild (active)" : "🐻 Wild Shape"}</button>`;
    }
    case "Warlock":
      return `<button class="combat-btn combat-btn--class" id="cbtn-class" title="Eldritch Blast: 1d10+CHA force damage, no MP cost">👁️ Eldritch Blast</button>`;
    case "Wizard": {
      const arcRecUsed = ca.arcaneRecoveryUsed ?? false;
      return `<button class="combat-btn combat-btn--class" id="cbtn-class" ${arcRecUsed ? "disabled" : ""} title="Arcane Recovery: restore floor(level/2)*2 MP (1x/combat)">${arcRecUsed ? "📚 Recovery (used)" : "📚 Arcane Recovery"}</button>`;
    }
    default:
      return "";
  }
}

const _EFFECT_ICONS = {
  poison: "☠️",
  stun: "💫",
  regen: "💪",
  burning: "🔥",
  bleeding: "🩸",
  frightened: "😨",
  blinded: "🙈",
  prone: "⬇️",
};

/**
 * Return a span of status-effect badges for a combatant participant or an
 * array of effects directly.
 * @param {CombatParticipant|Array} participantOrEffects
 */
function _effectBadges(participantOrEffects) {
  const effects = Array.isArray(participantOrEffects)
    ? participantOrEffects
    : (participantOrEffects.activeEffects ?? []);
  if (!effects.length) return "";
  return `<span class="status-badges">${effects
    .map(
      (e) =>
        `<span class="status-badge status-badge--${e.id}" title="${e.id} (${e.duration} turns)">${_EFFECT_ICONS[e.id] ?? "✨"}</span>`,
    )
    .join("")}</span>`;
}

/**
 * Spawn a floating combat text element.
 * Uses fixed positioning so it hovers over whichever card is given.
 * @param {string} anchorSelector - CSS selector for the target card element
 * @param {string} text           - e.g. "-5" or "+3"
 * @param {"damage"|"heal"|"crit"|"poison"} type
 */
function _spawnFCT(anchorSelector, text, type = "damage") {
  const anchor = document.querySelector(anchorSelector);
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const fct = document.createElement("div");
  fct.className = `fct fct--${type}`;
  fct.textContent = text;
  // Centre horizontally on the card, start 1/3 down
  fct.style.left = `${rect.left + rect.width / 2}px`;
  fct.style.top = `${rect.top + rect.height / 3}px`;
  document.body.appendChild(fct);
  fct.addEventListener("animationend", () => fct.remove(), { once: true });
}

/**
 * Apply a violent shake animation to the combat HUD for crits / big hits.
 */
function _shakeHUD() {
  const hud = document.querySelector("#combat-hud");
  if (!hud) return;
  hud.classList.remove("shake-effect");
  void hud.offsetWidth; // force reflow so the class re-triggers
  hud.classList.add("shake-effect");
  hud.addEventListener(
    "animationend",
    () => hud.classList.remove("shake-effect"),
    { once: true },
  );
}

function mountCombatHUD() {
  try {
    // Remove any existing HUD
    document.querySelector("#combat-hud")?.remove();

    const hud = document.createElement("div");
    hud.id = "combat-hud";
    hud.innerHTML = `
    <div class="combat-layout">

      <!-- Turn order strip -->
      <div class="turn-strip" id="turn-strip"></div>

      <!-- Main combat area -->
      <div class="combat-main">
        <!-- Enemy cards -->
        <div class="enemy-cards" id="enemy-cards"></div>

        <!-- Player combat actions -->
        <div class="combat-actions" id="combat-actions">
          <button class="combat-btn combat-btn--attack" id="cbtn-attack">⚔️ Attack</button>
          <span id="ammo-badge" class="ammo-badge" style="display:none" title="Ammo remaining"></span>
          <button class="combat-btn combat-btn--dodge"  id="cbtn-dodge" >🛡 Dodge</button>
          <button class="combat-btn combat-btn--dash"   id="cbtn-dash"  >💨 Dash</button>
          <button class="combat-btn combat-btn--disengage" id="cbtn-disengage">↩️ Disengage</button>
          <button class="combat-btn combat-btn--spell"  id="cbtn-spell" >🔮 Spells</button>
          <button class="combat-btn combat-btn--item"   id="cbtn-item"  >🧬 Item</button>
          ${_classAbilityHtml(gameStore.getState().player)}
          <button class="combat-btn combat-btn--end"    id="cbtn-end"   >⏭ End Turn</button>
        </div>

        <!-- Player HP bar -->
        <div class="player-combat-bar" id="player-combat-bar"></div>
      </div>

      <!-- Combat log -->
      <div class="combat-log" id="combat-log"></div>

    </div>
  `;

    document.body.appendChild(hud);

    wireButtons();
    subscribeToState();

    // Initial render
    const state = gameStore.getState();
    renderTurnStrip(state.combat);
    renderEnemyCards(state.combat);
    renderPlayerBar(state.player);
    renderCombatLog(state.combat.log);
    updateButtonState(state);
    console.log(
      "[CombatUI] HUD mounted. Turn order:",
      state.combat.turnOrder.map((p) => `${p.name} (hp:${p.hp})`),
    );
  } catch (err) {
    console.error("[CombatUI] mountCombatHUD CRASHED:", err);
  }
}

function unmountCombatHUD() {
  _unsubs.forEach((fn) => fn());
  _unsubs = [];

  const hud = document.querySelector("#combat-hud");
  if (hud) {
    hud.classList.add("combat-hud--exit");
    setTimeout(() => hud.remove(), 400);
  }
}

// ── State Subscriptions ───────────────────────────────────────────────────────

function subscribeToState() {
  _unsubs.push(
    gameStore.select(
      (s) => s.combat,
      (combat, state) => {
        renderTurnStrip(combat);
        renderEnemyCards(combat);
        renderCombatLog(combat.log);
        updateButtonState(state);
      },
    ),
    gameStore.select(
      (s) => {
        const eff =
          s.combat.turnOrder.find((p) => p.isPlayer)?.activeEffects ?? [];
        const concId = s.player.concentration?.spellId ?? "";
        return `${s.player.hp}|${s.player.mana ?? 0}|${s.player.ac}|${s.player.tempHp ?? 0}|${concId}|${eff.map((e) => `${e.id}:${e.duration}`).join(",")}`;
      },
      (_, state) => {
        const playerEffects =
          state.combat.turnOrder.find((p) => p.isPlayer)?.activeEffects ?? [];
        renderPlayerBar(state.player, playerEffects);
      },
    ),
  );
}

// ── Render Functions ──────────────────────────────────────────────────────────

function renderTurnStrip(combat) {
  const el = document.querySelector("#turn-strip");
  if (!el) return;

  el.innerHTML = combat.turnOrder
    .filter((p) => p.isPlayer || (p.hp ?? 1) > 0) // hide dead enemies
    .map((p) => {
      // Bug fix: use actor ID (not array index) — currentTurnIndex is an index
      // into the *alive* array which diverges from turnOrder after enemies die.
      const isCurrent = p.id === combat.currentTurnActorId;
      const hpPct = p.maxHp ? Math.round((p.hp / p.maxHp) * 100) : 100;
      return `
      <div class="turn-token ${isCurrent ? "turn-token--active" : ""} ${p.isPlayer ? "turn-token--player" : "turn-token--enemy"}">
        <span class="token-name">${p.name}</span>
        <div class="token-hp-bar">
          <div class="token-hp-fill" style="width:${hpPct}%"></div>
        </div>
        <span class="token-init">${p.initiative}</span>
        ${_effectBadges(p)}
      </div>
    `;
    })
    .join("");
}

function renderEnemyCards(combat) {
  const el = document.querySelector("#enemy-cards");
  if (!el) return;

  const enemies = combat.turnOrder.filter(
    (p) => !p.isPlayer && (p.hp ?? 1) > 0,
  );
  el.innerHTML = enemies
    .map((e) => {
      const hpPct = e.maxHp ? Math.round((e.hp / e.maxHp) * 100) : 100;
      const hpColour =
        hpPct > 60
          ? "var(--color-success)"
          : hpPct > 25
            ? "#b8902a"
            : "var(--color-danger)";
      return `
      <div class="enemy-card" data-enemy-id="${e.id}">
        <div class="enemy-name">${e.name}${_effectBadges(e)}</div>
        <div class="enemy-hp-track">
          <div class="enemy-hp-fill" style="width:${hpPct}%; background:${hpColour}"></div>
        </div>
        <div class="enemy-stats">AC ${e.ac ?? "?"} · ${e.hp ?? "?"}/${e.maxHp ?? "?"} HP</div>
        <button class="btn-target" data-enemy-id="${e.id}">🎯 Target</button>
      </div>
    `;
    })
    .join("");

  // Restore previously selected target (lost on innerHTML rebuild)
  if (_targetedEnemyId) {
    const restoredCard = el.querySelector(
      `.enemy-card[data-enemy-id="${_targetedEnemyId}"]`,
    );
    if (restoredCard) {
      restoredCard.classList.add("enemy-card--targeted");
    } else {
      // Enemy died — clear the stale target
      _targetedEnemyId = null;
    }
  }

  // Target buttons
  el.querySelectorAll(".btn-target").forEach((btn) => {
    btn.addEventListener("click", () => {
      const clickedId = btn.dataset.enemyId;
      const alreadySelected = _targetedEnemyId === clickedId;
      // Deselect all
      el.querySelectorAll(".enemy-card").forEach((c) =>
        c.classList.remove("enemy-card--targeted"),
      );
      if (alreadySelected) {
        // Toggle off
        _targetedEnemyId = null;
      } else {
        _targetedEnemyId = clickedId;
        const card = el.querySelector(
          `.enemy-card[data-enemy-id="${clickedId}"]`,
        );
        card?.classList.add("enemy-card--targeted");
      }
    });
  });
}

function renderPlayerBar(player, effects = []) {
  const el = document.querySelector("#player-combat-bar");
  if (!el) return;

  const hpPct = player.maxHp ? Math.round((player.hp / player.maxHp) * 100) : 0;
  const manaPct = player.maxMana
    ? Math.round(((player.mana ?? 0) / player.maxMana) * 100)
    : 0;
  const manaHtml =
    player.maxMana > 0
      ? `<div class="pcb-mana-track" title="${player.mana ?? 0} / ${player.maxMana} MP">
        <div class="pcb-mana-fill" style="width:${manaPct}%"></div>
       </div>
       <span class="pcb-mana-text">🔮 ${player.mana ?? 0}/${player.maxMana}</span>`
      : "";

  // Temporary HP badge
  const tempHp = player.tempHp ?? 0;
  const tempHpHtml =
    tempHp > 0
      ? `<span class="pcb-temphp" title="Temporary HP — absorbs damage first">🛡 +${tempHp} THP</span>`
      : "";

  // Concentration indicator
  const concHtml = player.concentration
    ? `<span class="pcb-conc" title="Concentrating on ${player.concentration.spellName}">🔵 ${player.concentration.spellName}</span>`
    : "";

  el.innerHTML = `
    <span class="pcb-name">${player.name}</span>
    <div class="pcb-hp-track">
      <div class="pcb-hp-fill" style="width:${hpPct}%"></div>
    </div>
    <span class="pcb-hp-text">${player.hp} / ${player.maxHp}</span>
    ${tempHpHtml}
    <span class="pcb-ac">🛡 ${player.ac}</span>
    ${manaHtml}
    ${concHtml}
    ${_effectBadges(effects)}
  `;
}

function renderCombatLog(log) {
  const el = document.querySelector("#combat-log");
  if (!el) return;

  const entries = [...log].reverse().slice(0, 30);
  el.innerHTML = entries
    .map(
      (entry) => `
    <div class="log-entry">
      <span class="log-round">R${entry.round}</span>
      <span class="log-text"><strong>${entry.actor}</strong> ${entry.action} — ${entry.result}</span>
    </div>
  `,
    )
    .join("");
}

function updateButtonState(state) {
  const isMyTurn = state.session.isMyTurn;
  // Use isMyTurn directly — in solo mode this is always true which is correct
  // (buttons should be interactive when it's the player's turn).
  // Enemy-turn lockout is handled by disabling buttons explicitly in the
  // COMBAT_TURN_START handler below, independently of this function.
  const isActuallyPlayerTurn = isMyTurn;
  // While in death-save mode all normal action buttons are locked — only
  // the death-save overlay button (#ds-roll-btn) should be interactive.
  const isUnconscious = state.player.deathSaveActive ?? false;
  [
    "cbtn-attack",
    "cbtn-dodge",
    "cbtn-dash",
    "cbtn-disengage",
    "cbtn-end",
    "cbtn-item",
  ].forEach((id) => {
    const btn = document.querySelector(`#${id}`);
    if (btn) btn.disabled = !isActuallyPlayerTurn || isUnconscious;
  });

  // Class ability button: disable when not player's turn (then let _refreshClassButton
  // handle its own per-ability disabled logic when it IS the player's turn)
  const classBtn = document.querySelector("#cbtn-class");
  if (classBtn) {
    if (!isActuallyPlayerTurn || isUnconscious) {
      classBtn.disabled = true;
    } else {
      // Re-apply ability-specific enabled/disabled state
      _refreshClassButton();
    }
  }

  const spellBtn = document.querySelector("#cbtn-spell");
  if (spellBtn) {
    const hasSpells = (state.player.knownSpells ?? []).length > 0;
    const hasMana = (state.player.mana ?? 0) > 0;
    spellBtn.disabled = !isActuallyPlayerTurn || !hasSpells || isUnconscious;
    spellBtn.title = !hasSpells
      ? "You know no spells"
      : !hasMana
        ? "No mana remaining"
        : "Cast a spell";
    // Dim further when out of mana (still clickable to see the list)
    spellBtn.classList.toggle(
      "combat-btn--oom",
      isActuallyPlayerTurn && hasSpells && !hasMana,
    );
  }

  // Off-hand attack button — visible only when a sidearm weapon (not shield) is equipped
  const offhandBtn = document.querySelector("#cbtn-offhand");
  if (offhandBtn) {
    const offhandSlot = state.player.equipment?.offhand;
    const offhandTpl = offhandSlot
      ? EQUIPMENT_TEMPLATES[offhandSlot.itemId]
      : null;
    const isOffhandWeapon = (offhandTpl?.bonuses?.damageDie ?? 0) > 0;
    offhandBtn.style.display = isOffhandWeapon ? "" : "none";
    offhandBtn.disabled =
      !isActuallyPlayerTurn ||
      isUnconscious ||
      (state.player.classAbilities?.offhandUsed ?? false);
    offhandBtn.title = isOffhandWeapon
      ? `Off-hand attack with ${offhandTpl.name}`
      : "No sidearm weapon equipped";
  }

  // Attack button: label, tooltip, ammo badge
  const atkBtn = document.querySelector("#cbtn-attack");
  const ammoBadge = document.querySelector("#ammo-badge");
  if (atkBtn) {
    const wepSlot = state.player.equipment?.weapon;
    const wepTpl = wepSlot ? EQUIPMENT_TEMPLATES[wepSlot.itemId] : null;
    const isRangedWep = wepTpl?.bonuses?.ranged ?? false;
    const cantrip = _getCantripData(state.player, isRangedWep);

    if (cantrip) {
      // Spellcaster with no bow/crossbow → show cantrip button
      atkBtn.textContent = `${cantrip.icon} ${cantrip.name}`;
      const ablKey = cantrip.abilityKey.toUpperCase();
      atkBtn.title = `${ablKey} (cantrip · manát nem fogyaszt · ${cantrip.range} mező)`;
      if (ammoBadge) ammoBadge.style.display = "none";
    } else {
      atkBtn.textContent = "⚔️ Attack";
      const isFinesse = wepTpl?.bonuses?.finesse ?? false;
      const ammoType = wepTpl?.bonuses?.ammoType ?? "arrow";
      const strMod = Math.floor(((state.player.abilities?.str ?? 10) - 10) / 2);
      const dexMod = Math.floor(((state.player.abilities?.dex ?? 10) - 10) / 2);
      let statLabel;
      if (isRangedWep) {
        statLabel = `DEX (ranged)`;
      } else if (isFinesse) {
        statLabel = dexMod >= strMod ? `DEX (finesse)` : `STR (finesse)`;
      } else {
        statLabel = `STR`;
      }
      atkBtn.title = `Attack using ${statLabel}`;
      if (ammoBadge) {
        if (isRangedWep) {
          const ammoItem = state.player.inventory?.find(
            (i) => i.itemId === ammoType && (i.quantity ?? 0) > 0,
          );
          const ammoCount = ammoItem?.quantity ?? 0;
          ammoBadge.textContent = `🪃 ${ammoCount}`;
          ammoBadge.style.display = "";
          ammoBadge.title = `${ammoCount} ${ammoType}${ammoType === "bolt" ? "s" : "s"} remaining`;
          ammoBadge.classList.toggle("ammo-badge--low", ammoCount <= 5);
        } else {
          ammoBadge.style.display = "none";
        }
      }
    }
  }
}

// ── Button Wiring ─────────────────────────────────────────────────────────────

function wireButtons() {
  document
    .querySelector("#cbtn-attack")
    ?.addEventListener("click", async () => {
      if (!_targetedEnemyId) {
        // Auto-target first living enemy and prompt to click again
        const firstCard = document.querySelector(".enemy-card");
        if (firstCard) {
          _targetedEnemyId = firstCard.dataset.enemyId;
          firstCard.classList.add("enemy-card--targeted");
        }
        return;
      }

      const targetId = _targetedEnemyId;
      const state = gameStore.getState();
      const player = state.player;

      // Resolve weapon: equipment slot (new system) → legacy inventory equipped item
      const weaponSlot = player.equipment?.weapon;
      const weaponTemplate = weaponSlot
        ? EQUIPMENT_TEMPLATES[weaponSlot.itemId]
        : null;
      const legacyEquipped = !weaponTemplate
        ? player.inventory.find((i) => i.equipped && i.type === "weapon")
        : null;

      const strMod = Math.floor((player.abilities.str - 10) / 2);
      const dexMod = Math.floor((player.abilities.dex - 10) / 2);
      const isFinesse =
        weaponTemplate?.bonuses?.finesse ?? legacyEquipped?.finesse ?? false;

      // Ranged weapons (bows, crossbows) use DEX to attack and damage
      const _physicalRanged =
        weaponTemplate?.bonuses?.ranged ?? legacyEquipped?.ranged ?? false;

      // Spellcasters without a physical ranged weapon use a free cantrip
      const cantripData = _getCantripData(player, _physicalRanged);
      const isRanged = _physicalRanged || !!cantripData;

      // ── Ammo check — physical ranged weapons only (cantrips need no ammo) ──
      const _ammoType = weaponTemplate?.bonuses?.ammoType ?? "arrow";
      if (_physicalRanged) {
        const _ammoItem = player.inventory.find(
          (i) => i.itemId === _ammoType && (i.quantity ?? 0) > 0,
        );
        if (!_ammoItem) {
          appendCombatLog(
            `❌ No ${_ammoType === "bolt" ? "crossbow bolts" : "arrows"} left — buy some from a merchant!`,
          );
          return;
        }
        removeItem(_ammoType, 1); // consume one arrow/bolt per shot
      }

      // atkMod: cantrip → spell ability | ranged → DEX | finesse → max(STR,DEX) | melee → STR
      const spellMod = cantripData
        ? Math.floor(
            ((player.abilities?.[cantripData.abilityKey] ?? 10) - 10) / 2,
          )
        : 0;
      const atkStatMod = cantripData
        ? spellMod
        : _physicalRanged
          ? dexMod
          : isFinesse
            ? Math.max(strMod, dexMod)
            : strMod;
      const atkMod =
        atkStatMod + player.proficiencyBonus + (player.attackBonus ?? 0);

      // Versatile: use the larger die when no off-hand item is equipped
      const isVersatile = weaponTemplate?.bonuses?.versatile ?? false;
      const hasOffhand = !!player.equipment?.offhand;
      const damageDie = cantripData
        ? cantripData.die
        : isVersatile && !hasOffhand
          ? (weaponTemplate.bonuses.versatileDie ??
            weaponTemplate.bonuses.damageDie ??
            (legacyEquipped ? 6 : 4))
          : (weaponTemplate?.bonuses?.damageDie ?? (legacyEquipped ? 6 : 4));
      // Cantrips in D&D 5e: attack roll uses spell mod + prof, but damage has NO ability bonus
      const dmgNote = cantripData
        ? `1d${cantripData.die}`
        : (legacyEquipped?.damageNotation ?? `1d${damageDie}`);
      const dmgStatBonus = cantripData
        ? 0
        : _physicalRanged
          ? dexMod
          : isFinesse
            ? Math.max(strMod, dexMod)
            : strMod;
      const weaponBaseDmgBonus = cantripData
        ? 0
        : (weaponTemplate?.bonuses?.baseDmgBonus ?? 0);
      const dmgBonus = dmgStatBonus + weaponBaseDmgBonus;
      const weaponName = cantripData
        ? `${cantripData.icon} ${cantripData.name}`
        : (weaponTemplate?.name ?? legacyEquipped?.name ?? "unarmed strike");

      // ── Range check + adjacency disadvantage ────────────────────────────
      const combatState = gameStore.getState().combat;
      let hasDisadvantage = false;
      if (combatState.active) {
        const playerPos = combatState.turnOrder.find((p) => p.isPlayer);
        const targetPos = combatState.turnOrder.find((p) => p.id === targetId);
        if (playerPos && targetPos) {
          const weaponRangeSquares = cantripData
            ? cantripData.range
            : (weaponTemplate?.bonuses?.weaponRange ??
              legacyEquipped?.weaponRange ??
              playerPos.weaponRange ??
              1);
          const dist = calcDistance(playerPos, targetPos);
          if (dist > weaponRangeSquares) {
            appendCombatLog(
              `❌ Out of range — target is ${dist} sq away (weapon range: ${weaponRangeSquares} sq). Move closer or use the map.`,
            );
            return;
          }
          // Ranged weapons have Disadvantage when adjacent to ANY enemy
          // unless the Sharpshooter feat negates it (D&D 5e)
          if (isRanged) {
            const sharpshooter = (player.feats ?? []).includes("sharpshooter");
            if (!sharpshooter) {
              const adjacentEnemy = combatState.turnOrder.find(
                (p) =>
                  !p.isPlayer &&
                  (p.hp ?? 1) > 0 &&
                  calcDistance(playerPos, p) <= 1,
              );
              if (adjacentEnemy) {
                hasDisadvantage = true;
                appendCombatLog(
                  `⚠️ Disadvantage — ${adjacentEnemy.name} is adjacent while you use a ranged weapon!`,
                );
              }
            }
          }
        }
      }

      const dmgNotation =
        dmgBonus === 0
          ? dmgNote
          : dmgBonus > 0
            ? `${dmgNote}+${dmgBonus}`
            : `${dmgNote}-${Math.abs(dmgBonus)}`;

      // ── Class ability damage bonuses ────────────────────────────────────
      const ca = player.classAbilities ?? {};
      let finalDmgNotation = dmgNotation;
      let finalWeaponName = weaponName;

      // Barbarian Rage: +2 damage flat
      if (ca.rageActive) {
        finalDmgNotation = `${finalDmgNotation}+2`;
        finalWeaponName += " [Rage]";
      }

      // Rogue Sneak Attack: +Nd6 bonus damage (N = ceil(level/2))
      if (ca.sneakAttackPending) {
        const snkDice = Math.ceil((player.level ?? 1) / 2);
        finalDmgNotation = `${finalDmgNotation}+${snkDice}d6`;
        finalWeaponName += " [Sneak Attack]";
        // Clear the pending flag after use
        gameStore.setState(
          {
            player: {
              ...gameStore.getState().player,
              classAbilities: { ...ca, sneakAttackPending: false },
            },
          },
          "combatUI:sneakAttackUsed",
        );
        _refreshClassButton();
      }

      // Paladin Divine Smite: +2d8 radiant when armed
      if (ca.smitePending) {
        finalDmgNotation = `${finalDmgNotation}+2d8`;
        finalWeaponName += " [Smite]";
        gameStore.setState(
          {
            player: {
              ...gameStore.getState().player,
              classAbilities: { ...ca, smitePending: false },
            },
          },
          "combatUI:smiteUsed",
        );
        _refreshClassButton();
      }

      // Ranger Hunter's Mark: +1d6 when hitting the marked target
      if (ca.hunterMarkTarget && ca.hunterMarkTarget === targetId) {
        finalDmgNotation = `${finalDmgNotation}+1d6`;
        finalWeaponName += " [Hunter's Mark]";
      }

      // ── Extra Attack: Fighter/Paladin/Barbarian/Ranger level 5+ ──────────
      const EXTRA_ATTACK_CLASSES = [
        "Fighter",
        "Paladin",
        "Barbarian",
        "Ranger",
      ];
      const hasExtraAttack =
        EXTRA_ATTACK_CLASSES.includes(player.class) &&
        (player.level ?? 1) >= 5 &&
        !ca.extraAttackUsedThisTurn;

      if (hasExtraAttack) {
        // First attack: don't advance turn so we can offer the second
        await performAttack(player.id ?? "player", targetId, {
          attackBonus: atkMod,
          damageNotation: finalDmgNotation,
          damageName: finalWeaponName,
          disadvantage: hasDisadvantage,
          skipTurnAdvance: true,
        });
        // Mark extra attack as used
        const stAfter = gameStore.getState();
        gameStore.setState(
          {
            player: {
              ...stAfter.player,
              classAbilities: {
                ...stAfter.player.classAbilities,
                extraAttackUsedThisTurn: true,
              },
            },
          },
          "combatUI:extraAttackUsed",
        );
        // Show second attack prompt
        _showExtraAttackPrompt(targetId);
      } else {
        await performAttack(player.id ?? "player", targetId, {
          attackBonus: atkMod,
          damageNotation: finalDmgNotation,
          damageName: finalWeaponName,
          disadvantage: hasDisadvantage,
        });
      }
    });

  document.querySelector("#cbtn-dodge")?.addEventListener("click", () => {
    const stDodge = gameStore.getState();
    gameStore.setState(
      { player: { ...stDodge.player, dodging: true } },
      "combatUI:dodge",
    );
    advanceTurn();
    appendCombatLog(
      "🛡️ You Dodge — attacks against you have Disadvantage until your next turn.",
    );
  });

  document.querySelector("#cbtn-dash")?.addEventListener("click", () => {
    const stDash = gameStore.getState();
    const newDashOrder = stDash.combat.turnOrder.map((p) =>
      p.isPlayer
        ? {
            ...p,
            movementRemaining:
              (p.movementRemaining ?? 0) + (p.movementSpeed ?? 30),
          }
        : p,
    );
    gameStore.setState(
      { combat: { ...stDash.combat, turnOrder: newDashOrder } },
      "combatUI:dash",
    );
    // D&D 5e: Dash does NOT end the turn — the player gets to use the extra
    // movement (and can still attack, cast, etc.).
    appendCombatLog("💨 You Dash — movement range doubled this turn.");
  });

  document.querySelector("#cbtn-disengage")?.addEventListener("click", () => {
    // Disengage: move away without provoking opportunity attacks; mark reaction used
    const st = gameStore.getState();
    const ca = st.player.classAbilities ?? {};
    gameStore.setState(
      {
        player: {
          ...st.player,
          classAbilities: { ...ca, reactionAvailable: false },
        },
      },
      "combatUI:disengage",
    );
    advanceTurn();
    appendCombatLog(
      "↩️ You Disengage — movement this turn won't provoke Opportunity Attacks.",
    );
  });

  document.querySelector("#cbtn-end")?.addEventListener("click", () => {
    advanceTurn();
  });

  // ── Off-hand attack (bonus action) ─────────────────────────────────────
  document
    .querySelector("#cbtn-offhand")
    ?.addEventListener("click", async () => {
      if (!_targetedEnemyId) {
        appendCombatLog("🎯 Target an enemy first, then use Off-hand Attack.");
        return;
      }
      const st = gameStore.getState();
      const player = st.player;
      const offhandSlot = player.equipment?.offhand;
      const offhandTpl = offhandSlot
        ? EQUIPMENT_TEMPLATES[offhandSlot.itemId]
        : null;
      if (!offhandTpl?.bonuses?.damageDie) return;

      // Mark offhand as used this turn (one bonus action per turn)
      gameStore.setState(
        {
          player: {
            ...player,
            classAbilities: {
              ...(player.classAbilities ?? {}),
              offhandUsed: true,
            },
          },
        },
        "combatUI:offhandUsed",
      );

      const strMod = Math.floor((player.abilities.str - 10) / 2);
      const dexMod = Math.floor((player.abilities.dex - 10) / 2);
      const isFinesse = offhandTpl.bonuses.finesse ?? false;
      const atkStatMod = isFinesse ? Math.max(strMod, dexMod) : strMod;
      // Off-hand attack: proficiency + stat mod (no equipment attackBonus from offhand for attack roll)
      const atkMod = atkStatMod + (player.proficiencyBonus ?? 2);
      const damageDie = offhandTpl.bonuses.damageDie ?? 4;
      // D&D 5e: no ability modifier added to damage for the off-hand attack
      await performAttack(player.id ?? "player", _targetedEnemyId, {
        attackBonus: atkMod,
        damageNotation: `1d${damageDie}`,
        damageName: `${offhandTpl.name} [Off-hand]`,
      });
    });

  document.querySelector("#cbtn-spell")?.addEventListener("click", () => {
    _openSpellPicker();
  });

  document.querySelector("#cbtn-item")?.addEventListener("click", () => {
    toggleInventory();
  });

  // ── Class ability button ────────────────────────────────────────────────
  document.querySelector("#cbtn-class")?.addEventListener("click", () => {
    _handleClassAbility();
  });
}

// ── Class Ability Logic ───────────────────────────────────────────────────────

/**
 * Handles the class-specific action button for Fighter, Barbarian, Rogue, Monk.
 * Reads player.class and dispatches the appropriate ability.
 */
function _handleClassAbility() {
  const state = gameStore.getState();
  const player = state.player;
  const cls = player.class ?? "";
  const ca = player.classAbilities ?? {};

  switch (cls) {
    case "Fighter": {
      // Second Wind: heal 1d10 + level HP, once per short rest
      if (ca.secondWindUsed) {
        appendCombatLog("⚠️ Second Wind already used — rest to recover it.");
        return;
      }
      const healed = roll(`1d10+${player.level ?? 1}`).total;
      const newHp = Math.min(player.maxHp, (player.hp ?? 0) + healed);
      gameStore.setState(
        {
          player: {
            ...player,
            hp: newHp,
            classAbilities: { ...ca, secondWindUsed: true },
          },
          // Sync into combat turn order so HP bar updates
          combat: {
            ...state.combat,
            turnOrder: state.combat.turnOrder.map((p) =>
              p.isPlayer ? { ...p, hp: newHp, maxHp: player.maxHp } : p,
            ),
          },
        },
        "combatUI:secondWind",
      );
      appendCombatLog(
        `💨 Second Wind! You draw on years of training and regain ${healed} HP. (${player.hp} → ${newHp})`,
      );
      _refreshClassButton();
      break;
    }

    case "Barbarian": {
      // Rage: toggle. If already raging, end rage manually.
      if (ca.rageActive) {
        // End rage early
        gameStore.setState(
          {
            player: {
              ...player,
              classAbilities: { ...ca, rageActive: false, rageRoundsLeft: 0 },
            },
          },
          "combatUI:rageEnd",
        );
        appendCombatLog("🪓 Rage fades. You return to a cold focus.");
        _refreshClassButton();
        return;
      }
      if ((ca.rageUses ?? 2) <= 0) {
        appendCombatLog("⚠️ No Rage uses remaining — take a long rest.");
        return;
      }
      gameStore.setState(
        {
          player: {
            ...player,
            classAbilities: {
              ...ca,
              rageActive: true,
              rageRoundsLeft: 3,
              rageUses: (ca.rageUses ?? 2) - 1,
            },
          },
        },
        "combatUI:rageStart",
      );
      appendCombatLog(
        `🔥 RAGE! Damage +2 for the next 3 rounds, physical damage halved. (${(ca.rageUses ?? 2) - 1} uses left)`,
      );
      _refreshClassButton();
      break;
    }

    case "Rogue": {
      // Sneak Attack: applies automatically on next attack — flag it as pending
      appendCombatLog(
        `🗡️ Sneak Attack ready! Your next attack deals +${Math.ceil((player.level ?? 1) / 2)}d6 bonus damage.`,
      );
      gameStore.setState(
        {
          player: {
            ...player,
            classAbilities: { ...ca, sneakAttackPending: true },
          },
        },
        "combatUI:sneakAttack",
      );
      break;
    }

    case "Monk": {
      // Flurry of Blows: spend 1 ki for a bonus unarmed strike (auto-hit with min damage)
      if ((ca.kiPoints ?? 0) <= 0) {
        appendCombatLog(
          "⚠️ No Ki points remaining — take a short or long rest.",
        );
        return;
      }
      if (!_targetedEnemyId) {
        appendCombatLog("🥋 Select a target first, then use Flurry of Blows.");
        return;
      }
      const targetId = _targetedEnemyId;
      const unarmed = Math.floor(((player.abilities?.dex ?? 10) - 10) / 2) + 1;
      gameStore.setState(
        {
          player: {
            ...player,
            classAbilities: { ...ca, kiPoints: (ca.kiPoints ?? 1) - 1 },
          },
        },
        "combatUI:flurryKiSpend",
      );
      import("../../engine/actionDispatcher.js").then(({ performAttack }) => {
        performAttack(player.id ?? "player", targetId, {
          attackBonus:
            player.proficiencyBonus +
            Math.floor(((player.abilities?.dex ?? 10) - 10) / 2),
          damageNotation: `1d4+${unarmed}`,
          damageName: "unarmed strike (Flurry)",
        });
      });
      _refreshClassButton();
      break;
    }

    case "Paladin": {
      // Divine Smite: toggle smitePending — adds +2d8 radiant to the next hit
      const nowPending = !ca.smitePending;
      gameStore.setState(
        {
          player: {
            ...player,
            classAbilities: { ...ca, smitePending: nowPending },
          },
        },
        "combatUI:divineSmite",
      );
      appendCombatLog(
        nowPending
          ? "⚡ Divine Smite armed — your next hit deals +2d8 radiant damage!"
          : "⚡ Divine Smite deactivated.",
      );
      _refreshClassButton();
      break;
    }

    case "Ranger": {
      // Hunter's Mark: mark a targeted enemy for +1d6 bonus damage (Concentration)
      if (!_targetedEnemyId) {
        appendCombatLog(
          "🎯 Select a target enemy first, then activate Hunter's Mark.",
        );
        return;
      }
      const markTargetId = _targetedEnemyId;
      const markEnemy = gameStore
        .getState()
        .combat.turnOrder.find((p) => p.id === markTargetId);
      // Break old concentration if any
      if (player.concentration) {
        appendCombatLog(
          `🔵 Concentration on ${player.concentration.spellName} broken.`,
        );
        eventBus.emit(EVENTS.CONCENTRATION_BROKEN, {
          spellId: player.concentration.spellId,
          spellName: player.concentration.spellName,
        });
      }
      gameStore.setState(
        {
          player: {
            ...player,
            concentration: {
              spellId: "hunters_mark",
              spellName: "Hunter's Mark",
            },
            classAbilities: { ...ca, hunterMarkTarget: markTargetId },
          },
        },
        "combatUI:hunterMark",
      );
      appendCombatLog(
        `🎯 Hunter's Mark: ${markEnemy?.name ?? "enemy"} marked — +1d6 damage on hits (Concentration).`,
      );
      _refreshClassButton();
      break;
    }

    case "Bard": {
      // Bardic Inspiration: add +1d6 to next attack roll
      if (ca.bardInspirationUsed) {
        appendCombatLog(
          "🎵 Bardic Inspiration already used — rest to recover.",
        );
        return;
      }
      const inspBonus = roll("1d6").total;
      gameStore.setState(
        {
          player: {
            ...player,
            attackBonus: (player.attackBonus ?? 0) + inspBonus,
            classAbilities: {
              ...ca,
              bardInspirationUsed: true,
              bardBonusDie: 0,
            },
          },
        },
        "combatUI:bardInspiration",
      );
      appendCombatLog(
        `🎵 Bardic Inspiration! +${inspBonus} to your attack bonus this combat.`,
      );
      _refreshClassButton();
      break;
    }

    case "Sorcerer": {
      // Sorcery Surge: spend 2 MP, deal 1d6 to all living enemies
      const surgesLeft = ca.sorcerySurgesLeft ?? 2;
      if (surgesLeft <= 0) {
        appendCombatLog("⚠️ No Sorcery Surges remaining.");
        return;
      }
      if ((player.mana ?? 0) < 2) {
        appendCombatLog("⚠️ Not enough mana for Sorcery Surge (need 2 MP).");
        return;
      }
      const surgeEnemies = state.combat.turnOrder.filter(
        (p) => !p.isPlayer && (p.hp ?? 0) > 0,
      );
      if (!surgeEnemies.length) {
        appendCombatLog("⚠️ No enemies to target.");
        return;
      }
      const surgeDmg = roll("1d6").total;
      surgeEnemies.forEach((e) => applyDamage(e.id, surgeDmg));
      gameStore.setState(
        {
          player: {
            ...player,
            mana: (player.mana ?? 0) - 2,
            classAbilities: { ...ca, sorcerySurgesLeft: surgesLeft - 1 },
          },
        },
        "combatUI:sorcerySurge",
      );
      appendCombatLog(
        `✨ Sorcery Surge! ${surgeDmg} magic damage to all enemies. (${surgesLeft - 1} surges left)`,
      );
      _refreshClassButton();
      break;
    }

    case "Cleric": {
      // Sacred Flame: 1d8+WIS radiant, 0 MP, targeted
      if (!_targetedEnemyId) {
        appendCombatLog("🌟 Select a target first for Sacred Flame.");
        return;
      }
      const sfTargetId = _targetedEnemyId;
      const wisMod = Math.floor(((player.abilities?.wis ?? 10) - 10) / 2);
      const sfDmg = Math.max(
        1,
        roll(`1d8${wisMod >= 0 ? `+${wisMod}` : wisMod}`).total,
      );
      applyDamage(sfTargetId, sfDmg);
      appendCombatLog(`🌟 Sacred Flame! ${sfDmg} radiant damage.`);
      advanceTurn();
      break;
    }

    case "Druid": {
      // Wild Shape: toggle +2 AC and per-turn HP regen for 3 rounds
      if (ca.wildShapeActive) {
        gameStore.setState(
          {
            player: {
              ...player,
              ac: (player.ac ?? 10) - 2,
              classAbilities: {
                ...ca,
                wildShapeActive: false,
                wildShapeRoundsLeft: 0,
              },
            },
          },
          "combatUI:wildShapeEnd",
        );
        appendCombatLog(
          "🐻 Wild Shape ends. You return to humanoid form. (-2 AC)",
        );
        _refreshClassButton();
        return;
      }
      gameStore.setState(
        {
          player: {
            ...player,
            ac: (player.ac ?? 10) + 2,
            classAbilities: {
              ...ca,
              wildShapeActive: true,
              wildShapeRoundsLeft: 3,
            },
          },
          combat: {
            ...state.combat,
            turnOrder: state.combat.turnOrder.map((p) =>
              p.isPlayer ? { ...p, ac: (p.ac ?? 10) + 2 } : p,
            ),
          },
        },
        "combatUI:wildShapeStart",
      );
      appendCombatLog(
        "🐻 Wild Shape! +2 AC, regenerate 1 HP per turn for 3 rounds.",
      );
      _refreshClassButton();
      break;
    }

    case "Warlock": {
      // Eldritch Blast: 1d10+CHA force, 0 MP, targeted
      if (!_targetedEnemyId) {
        appendCombatLog("👁️ Select a target first for Eldritch Blast.");
        return;
      }
      const ebTargetId = _targetedEnemyId;
      const chaMod = Math.floor(((player.abilities?.cha ?? 10) - 10) / 2);
      const ebDmg = Math.max(
        1,
        roll(`1d10${chaMod >= 0 ? `+${chaMod}` : chaMod}`).total,
      );
      applyDamage(ebTargetId, ebDmg);
      appendCombatLog(`👁️ Eldritch Blast! ${ebDmg} force damage.`);
      advanceTurn();
      break;
    }

    case "Wizard": {
      // Arcane Recovery: restore floor(level/2)*2 MP, 1x/combat
      if (ca.arcaneRecoveryUsed) {
        appendCombatLog("📚 Arcane Recovery already used this combat.");
        return;
      }
      const restored = Math.max(2, Math.floor((player.level ?? 1) / 2) * 2);
      const newMana = Math.min(
        player.maxMana ?? 0,
        (player.mana ?? 0) + restored,
      );
      gameStore.setState(
        {
          player: {
            ...player,
            mana: newMana,
            classAbilities: { ...ca, arcaneRecoveryUsed: true },
          },
        },
        "combatUI:arcaneRecovery",
      );
      appendCombatLog(
        `📚 Arcane Recovery! Restored ${restored} MP. (${player.mana} → ${newMana})`,
      );
      _refreshClassButton();
      break;
    }

    default:
      break;
  }
}

/** Re-renders just the class ability button label/disabled state in-place. */
function _refreshClassButton() {
  const btn = document.querySelector("#cbtn-class");
  if (!btn) return;
  const player = gameStore.getState().player;
  const ca = player.classAbilities ?? {};
  const cls = player.class ?? "";

  switch (cls) {
    case "Fighter":
      btn.disabled = ca.secondWindUsed;
      btn.textContent = "💨 Second Wind";
      btn.title = ca.secondWindUsed
        ? "Already used — short rest to recover"
        : "Regain 1d10 + level HP (1/short rest)";
      break;
    case "Barbarian": {
      const uses = ca.rageUses ?? 2;
      btn.disabled = !ca.rageActive && uses <= 0;
      btn.textContent = ca.rageActive ? "🔥 Raging!" : `🪓 Rage (${uses} left)`;
      btn.classList.toggle("combat-btn--class-active", !!ca.rageActive);
      break;
    }
    case "Rogue":
      btn.textContent = ca.sneakAttackPending
        ? "🗡️ Sneak! (ready)"
        : "🗡️ Sneak Atk";
      break;
    case "Monk":
      btn.disabled = (ca.kiPoints ?? 0) <= 0;
      btn.textContent = `🥋 Flurry (${ca.kiPoints ?? 0} ki)`;
      break;
    case "Paladin":
      btn.disabled = false;
      btn.textContent = ca.smitePending ? "⚡ Smite Ready!" : "⚡ Divine Smite";
      btn.classList.toggle("combat-btn--class-active", !!ca.smitePending);
      btn.title = ca.smitePending
        ? "Smite armed — next hit adds +2d8 radiant (click to disarm)"
        : "Divine Smite: arm +2d8 radiant on your next hit";
      break;
    case "Ranger": {
      const hasTarget = !!ca.hunterMarkTarget;
      btn.textContent = hasTarget ? "🎯 Mark Active!" : "🎯 Hunter's Mark";
      btn.classList.toggle("combat-btn--class-active", hasTarget);
      btn.title = hasTarget
        ? "Hunter's Mark active — +1d6 on hits against marked enemy"
        : "Hunter's Mark: target an enemy for +1d6 bonus damage (Concentration)";
      break;
    }
    case "Bard":
      btn.disabled = !!ca.bardInspirationUsed;
      btn.textContent = ca.bardInspirationUsed
        ? "🎵 Inspiration (used)"
        : `🎵 Inspiration (d${ca.bardBonusDie || 6})`;
      break;
    case "Sorcerer": {
      const surges = ca.sorcerySurgesLeft ?? 2;
      btn.disabled = surges <= 0;
      btn.textContent = `✨ Sorcery Surge (${surges})`;
      btn.title = "Sorcery Surge: spend 2 MP to deal 1d6 to ALL enemies";
      break;
    }
    case "Cleric":
      btn.disabled = false;
      btn.textContent = "🌟 Sacred Flame";
      btn.title = "Sacred Flame: 1d8+WIS radiant damage, no MP cost";
      break;
    case "Druid": {
      const wildActive = ca.wildShapeActive ?? false;
      btn.disabled = false;
      btn.textContent = wildActive ? "🐻 Wild (active)" : "🐻 Wild Shape";
      btn.classList.toggle("combat-btn--class-active", wildActive);
      btn.title = wildActive
        ? "Wild Shape active — click to end early"
        : "Wild Shape: +2 AC, 1 HP regen/turn for 3 rounds";
      break;
    }
    case "Warlock":
      btn.disabled = false;
      btn.textContent = "👁️ Eldritch Blast";
      btn.title = "Eldritch Blast: 1d10+CHA force damage, no MP cost";
      break;
    case "Wizard": {
      const arcUsed = ca.arcaneRecoveryUsed ?? false;
      btn.disabled = arcUsed;
      btn.textContent = arcUsed ? "📚 Recovery (used)" : "📚 Arcane Recovery";
      btn.title = arcUsed
        ? "Already used — rest to recover"
        : "Arcane Recovery: restore floor(level/2)*2 MP (1x/combat)";
      break;
    }
    default:
      break;
  }
}

function appendCombatLog(text) {
  const el = document.querySelector("#combat-log");
  if (!el) return;
  const div = document.createElement("div");
  div.className = "log-entry log-entry--system";
  div.textContent = text;
  el.prepend(div);
}

// ── Spell Picker ──────────────────────────────────────────────────────────────

function _openSpellPicker() {
  // Close if already open (toggle)
  if (document.querySelector("#spell-picker")) {
    document.querySelector("#spell-picker").remove();
    return;
  }

  const state = gameStore.getState();
  const { mana = 0, maxMana = 0, knownSpells = [] } = state.player;

  if (!knownSpells.length) {
    appendCombatLog("✨ You have no spells to cast.");
    return;
  }

  const spellCardsHtml = knownSpells
    .map((id) => {
      const spell = SPELLS[id];
      if (!spell) return "";
      const affordable = mana >= spell.manaCost;
      return `
        <button
          class="spell-card ${!affordable ? "spell-card--oom" : ""}"
          data-spell-id="${id}"
        >
          <span class="spell-card-icon">${spell.icon}</span>
          <div class="spell-card-body">
            <span class="spell-card-name">${spell.name}</span>
            <span class="spell-card-desc">${spell.description}</span>
          </div>
          <span class="spell-card-cost ${!affordable ? "spell-card-cost--oom" : ""}">${spell.manaCost} MP</span>
        </button>
      `;
    })
    .join("");

  const picker = document.createElement("div");
  picker.id = "spell-picker";
  picker.className = "spell-picker";
  picker.innerHTML = `
    <div class="spell-picker-header">
      <span class="spell-picker-title">🔮 Spells</span>
      <span class="spell-picker-mana">${mana} / ${maxMana} MP</span>
      <button class="spell-picker-close" id="sp-close">✕</button>
    </div>
    <div class="spell-picker-list" id="spell-picker-list">
      ${spellCardsHtml}
    </div>
  `;

  document.querySelector("#combat-actions")?.appendChild(picker);

  // Live mana refresh — update card states whenever MP changes (e.g. mana regen on turn start)
  function _refreshPickerMana() {
    const p = document.querySelector("#spell-picker");
    if (!p) {
      unsub();
      return;
    }
    const { mana: m = 0, maxMana: mm = 0 } = gameStore.getState().player;
    const manaEl = p.querySelector(".spell-picker-mana");
    if (manaEl) manaEl.textContent = `${m} / ${mm} MP`;
    p.querySelectorAll(".spell-card[data-spell-id]").forEach((card) => {
      const sp = SPELLS[card.dataset.spellId];
      if (!sp) return;
      const can = m >= sp.manaCost;
      card.classList.toggle("spell-card--oom", !can);
      const costEl = card.querySelector(".spell-card-cost");
      if (costEl) costEl.classList.toggle("spell-card-cost--oom", !can);
    });
  }
  const unsub = gameStore.subscribe(_refreshPickerMana);

  function _closePicker() {
    unsub();
    picker.remove();
  }

  picker.querySelector("#sp-close")?.addEventListener("click", _closePicker);

  picker.querySelectorAll(".spell-card").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const spellId = btn.dataset.spellId;
      const spell = SPELLS[spellId];
      // Check mana at click time (not just at render time)
      const { mana: curMana = 0 } = gameStore.getState().player;
      if (curMana < spell.manaCost) {
        appendCombatLog(
          `✨ Not enough mana — need ${spell.manaCost} MP, have ${curMana} MP.`,
        );
        return;
      }
      _closePicker();

      if (spell.requiresTarget) {
        if (!_targetedEnemyId) {
          appendCombatLog(
            `🎯 Select a target first (🎯 Target button), then use Spells again to cast ${spell.name}.`,
          );
          return;
        }
        const targetId = _targetedEnemyId;
        try {
          const result = await castSpell(spellId, targetId);
          if (!result.ok) {
            appendCombatLog(`❌ Cannot cast: ${result.reason}`);
          } else {
            advanceTurn();
          }
        } catch (err) {
          console.error("[CombatUI] castSpell threw:", err);
          appendCombatLog("❌ Spell failed unexpectedly.");
          advanceTurn();
        }
      } else {
        try {
          const result = await castSpell(spellId, null);
          if (!result.ok) {
            appendCombatLog(`❌ Cannot cast: ${result.reason}`);
          } else {
            advanceTurn();
          }
        } catch (err) {
          console.error("[CombatUI] castSpell threw:", err);
          appendCombatLog("❌ Spell failed unexpectedly.");
          advanceTurn();
        }
      }
    });
  });
}

// ── Extra Attack Prompt ───────────────────────────────────────────────────────

/**
 * Shows a floating prompt offering a second attack (Extra Attack feature).
 * @param {string} defaultTargetId
 */
function _showExtraAttackPrompt(defaultTargetId) {
  // Remove any pre-existing prompt
  document.querySelector("#extra-attack-prompt")?.remove();

  const prompt = document.createElement("div");
  prompt.id = "extra-attack-prompt";
  prompt.className = "opp-attack-prompt";
  prompt.innerHTML = `
    <div class="opp-attack-card">
      <p class="opp-attack-title">⚔️ Extra Attack</p>
      <p class="opp-attack-desc">Level 5+ — make a second attack this turn!</p>
      <div class="opp-attack-buttons">
        <button class="btn-primary" id="eap-yes">Attack Again</button>
        <button class="btn-secondary" id="eap-skip">Skip (End Turn)</button>
      </div>
    </div>
  `;
  document.querySelector("#combat-hud")?.appendChild(prompt);

  prompt.querySelector("#eap-yes")?.addEventListener("click", async () => {
    prompt.remove();
    // Re-read current state for weapon stats
    const state = gameStore.getState();
    const player = state.player;
    const ca = player.classAbilities ?? {};
    const weaponSlot = player.equipment?.weapon;
    const weaponTemplate = weaponSlot
      ? EQUIPMENT_TEMPLATES[weaponSlot.itemId]
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
    const atkStatMod = isRanged
      ? dexMod
      : isFinesse
        ? Math.max(strMod, dexMod)
        : strMod;
    const atkMod2 =
      atkStatMod + player.proficiencyBonus + (player.attackBonus ?? 0);
    const damageDie =
      weaponTemplate?.bonuses?.damageDie ?? (legacyEquipped ? 6 : 4);
    const dmgNote = legacyEquipped?.damageNotation ?? `1d${damageDie}`;
    const dmgBonus = isRanged
      ? dexMod
      : isFinesse
        ? Math.max(strMod, dexMod)
        : strMod;
    const weaponName =
      weaponTemplate?.name ?? legacyEquipped?.name ?? "unarmed strike";
    const dmgNotation =
      dmgBonus === 0
        ? dmgNote
        : dmgBonus > 0
          ? `${dmgNote}+${dmgBonus}`
          : `${dmgNote}-${Math.abs(dmgBonus)}`;
    let finalDmg = dmgNotation;
    let finalName = weaponName;
    if (ca.rageActive) {
      finalDmg += "+2";
      finalName += " [Rage]";
    }
    if (ca.hunterMarkTarget && ca.hunterMarkTarget === defaultTargetId) {
      finalDmg += "+1d6";
      finalName += " [Hunter's Mark]";
    }
    appendCombatLog("⚔️ Extra Attack!");
    await performAttack(player.id ?? "player", defaultTargetId, {
      attackBonus: atkMod2,
      damageNotation: finalDmg,
      damageName: finalName + " [Extra]",
    });
  });

  prompt.querySelector("#eap-skip")?.addEventListener("click", () => {
    prompt.remove();
    advanceTurn();
  });
}

// ── Opportunity Attack Prompt ─────────────────────────────────────────────────

/**
 * Shows an opportunity attack reaction prompt.
 * @param {string} enemyId
 * @param {string} enemyName
 */
function _showOppAttackPrompt(enemyId, enemyName) {
  document.querySelector("#opp-attack-prompt")?.remove();

  const prompt = document.createElement("div");
  prompt.id = "opp-attack-prompt";
  prompt.className = "opp-attack-prompt";
  prompt.innerHTML = `
    <div class="opp-attack-card">
      <p class="opp-attack-title">⚡ Opportunity Attack!</p>
      <p class="opp-attack-desc">${enemyName} moved away — take a free attack?</p>
      <div class="opp-attack-buttons">
        <button class="btn-primary" id="oap-yes">Attack!</button>
        <button class="btn-secondary" id="oap-no">Decline</button>
      </div>
    </div>
  `;
  document.querySelector("#combat-hud")?.appendChild(prompt);

  // Auto-dismiss after 6 seconds
  const timeout = setTimeout(() => prompt.remove(), 6000);

  prompt.querySelector("#oap-yes")?.addEventListener("click", async () => {
    clearTimeout(timeout);
    prompt.remove();
    // Spend the reaction
    const st = gameStore.getState();
    const ca = st.player.classAbilities ?? {};
    gameStore.setState(
      {
        player: {
          ...st.player,
          classAbilities: { ...ca, reactionAvailable: false },
        },
      },
      "combatUI:oppAttackReaction",
    );
    // Perform the reaction attack (no turn advance — it's a reaction, not the player's turn)
    const player = gameStore.getState().player;
    const weaponSlot = player.equipment?.weapon;
    const weaponTemplate = weaponSlot
      ? EQUIPMENT_TEMPLATES[weaponSlot.itemId]
      : null;
    const legacyEquipped = !weaponTemplate
      ? player.inventory.find((i) => i.equipped && i.type === "weapon")
      : null;
    const strMod = Math.floor((player.abilities.str - 10) / 2);
    const dexMod = Math.floor((player.abilities.dex - 10) / 2);
    const isFinesse =
      weaponTemplate?.bonuses?.finesse ?? legacyEquipped?.finesse ?? false;
    const atkStatMod = isFinesse ? Math.max(strMod, dexMod) : strMod;
    const atkMod =
      atkStatMod + player.proficiencyBonus + (player.attackBonus ?? 0);
    const damageDie =
      weaponTemplate?.bonuses?.damageDie ?? (legacyEquipped ? 6 : 4);
    const dmgNote = legacyEquipped?.damageNotation ?? `1d${damageDie}`;
    const dmgBonus = isFinesse ? Math.max(strMod, dexMod) : strMod;
    const dmgNotation =
      dmgBonus === 0
        ? dmgNote
        : dmgBonus > 0
          ? `${dmgNote}+${dmgBonus}`
          : `${dmgNote}-${Math.abs(dmgBonus)}`;
    appendCombatLog(`⚡ Opportunity Attack against ${enemyName}!`);
    await performAttack(player.id ?? "player", enemyId, {
      attackBonus: atkMod,
      damageNotation: dmgNotation,
      damageName:
        (weaponTemplate?.name ?? legacyEquipped?.name ?? "unarmed strike") +
        " [OA]",
      skipTurnAdvance: true,
    });
  });

  prompt.querySelector("#oap-no")?.addEventListener("click", () => {
    clearTimeout(timeout);
    prompt.remove();
  });
}

// ── Death Save UI ─────────────────────────────────────────────────────────────

function _mountDeathSaveUI(playerName) {
  document.querySelector("#death-save-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "death-save-overlay";
  overlay.className = "death-save-overlay";
  overlay.innerHTML = `
    <div class="death-save-card">
      <h2 class="ds-title">⚠️ ${playerName ?? "You"} is Unconscious</h2>
      <p class="ds-subtitle">Roll a Death Saving Throw each turn. 3 successes = stable. 3 failures = dead.</p>

      <div class="ds-pips-row">
        <div class="ds-pips-group">
          <span class="ds-pips-label">Successes</span>
          <div class="ds-pips" id="ds-successes">
            <span class="ds-pip" data-idx="0"></span>
            <span class="ds-pip" data-idx="1"></span>
            <span class="ds-pip" data-idx="2"></span>
          </div>
        </div>
        <div class="ds-pips-group">
          <span class="ds-pips-label">Failures</span>
          <div class="ds-pips" id="ds-failures">
            <span class="ds-pip ds-pip--fail" data-idx="0"></span>
            <span class="ds-pip ds-pip--fail" data-idx="1"></span>
            <span class="ds-pip ds-pip--fail" data-idx="2"></span>
          </div>
        </div>
      </div>

      <div id="ds-result" class="ds-result"></div>
      <button id="ds-roll-btn" class="btn-primary ds-roll-btn">🎲 Roll Death Save (d20)</button>
    </div>
  `;

  document.body.appendChild(overlay);
  _wireDeathSave(overlay);
}

function _wireDeathSave(overlay) {
  const btn = overlay.querySelector("#ds-roll-btn");
  const resultEl = overlay.querySelector("#ds-result");

  btn.addEventListener("click", async () => {
    btn.disabled = true;

    const state = gameStore.getState();

    // Re-read saves from store (they may have changed)
    const saves = { ...state.player.deathSaves };

    const dieResult = roll("1d20");
    const value = dieResult.total;

    // Special rules
    if (value === 20) {
      // Miraculous recovery: regain 1 HP
      _resolveDeath(
        "stable",
        overlay,
        `Natural 20! ${state.player.name} miraculously recovers with 1 HP!`,
      );
      const p = gameStore.getState().player;
      gameStore.setState(
        {
          player: {
            ...p,
            hp: 1,
            conditions: p.conditions.filter((c) => c !== "unconscious"),
          },
        },
        "combatUI:deathSave20",
      );
      // Sync the recovered HP back into the combat turn order, then let
      // advanceTurn() decide: call endCombat() if no enemies remain, or
      // continue the fight if they do.
      _resumeCombatAfterStabilise();
      return;
    }

    if (value === 1) {
      saves.failures = Math.min(3, saves.failures + 2); // Nat 1 = 2 failures
      resultEl.textContent = `Rolled a 1! Two failures.`;
    } else if (value >= 10) {
      saves.successes = Math.min(3, saves.successes + 1);
      resultEl.textContent = `Rolled ${value} — Success!`;
    } else {
      saves.failures = Math.min(3, saves.failures + 1);
      resultEl.textContent = `Rolled ${value} — Failure.`;
    }

    // Update store
    const p = gameStore.getState().player;
    gameStore.setState(
      { player: { ...p, deathSaves: saves } },
      "combatUI:deathSave",
    );

    // Update pip display
    _renderDeathPips(overlay, saves);

    // Check resolution
    if (saves.successes >= 3) {
      _resolveDeath(
        "stable",
        overlay,
        `${p.name} stabilises and is no longer dying.`,
      );
      gameStore.setState(
        {
          player: {
            ...gameStore.getState().player,
            conditions: p.conditions.filter((c) => c !== "unconscious"),
            hp: 1,
          },
        },
        "combatUI:stabilise",
      );
      // Sync the recovered HP back into the turn order so endCombat() counts
      // the player as a survivor, then let advanceTurn() end or continue combat.
      _resumeCombatAfterStabilise();
    } else if (saves.failures >= 3) {
      _resolveDeath("dead", overlay, `${p.name} has died.`);
    } else {
      // Advance to enemy turns; the button re-arms when COMBAT_TURN_START
      // fires again on the player's next turn (see handler at top of file).
      advanceTurn();
    }
  });
}

/**
 * After a death-save stabilisation, write the player's new HP (1) back into
 * the combat turn order, then call advanceTurn().  advanceTurn will call
 * endCombat() when only one (or zero) combatant remains alive — covering the
 * common case where all enemies are already dead.
 */
function _resumeCombatAfterStabilise() {
  const s = gameStore.getState();
  if (!s.combat.active) return; // safety: already ended somehow
  const syncedOrder = s.combat.turnOrder.map((c) =>
    c.isPlayer ? { ...c, hp: 1 } : c,
  );
  gameStore.setState(
    { combat: { ...s.combat, turnOrder: syncedOrder } },
    "combatUI:syncTurnOrderAfterStabilise",
  );
  // Clear the deathSaveActive flag so the normal turn UI shows on next player turn
  const sAfter = gameStore.getState();
  if (sAfter.player.deathSaveActive) {
    gameStore.setState(
      { player: { ...sAfter.player, deathSaveActive: false } },
      "combatUI:clearDeathSaveActive",
    );
  }
  advanceTurn(); // ends combat (victory) if no enemies remain
}

function _renderDeathPips(overlay, saves) {
  overlay.querySelectorAll("#ds-successes .ds-pip").forEach((pip, i) => {
    pip.classList.toggle("ds-pip--filled", i < saves.successes);
  });
  overlay.querySelectorAll("#ds-failures .ds-pip").forEach((pip, i) => {
    pip.classList.toggle("ds-pip--filled", i < saves.failures);
  });
}

function _resolveDeath(outcome, overlay, message) {
  const resultEl = overlay.querySelector("#ds-result");
  const btn = overlay.querySelector("#ds-roll-btn");
  if (resultEl) resultEl.textContent = message;
  if (btn) btn.remove();

  if (outcome === "dead") {
    const title = overlay.querySelector(".ds-title");
    if (title) title.textContent = "💀 YOUR CHARACTER HAS DIED";
    // Short pause so the player sees the title flip before the screen clears
    setTimeout(() => {
      overlay.remove();
      endCombat(); // → emits COMBAT_ENDED (unmounts HUD) then COMBAT_DEFEAT
    }, 1800);
  } else {
    // Stable — remove overlay after a moment
    setTimeout(() => overlay.remove(), 3000);
  }
}

// ── Victory Modal ─────────────────────────────────────────────────────────────────

/**
 * @param {{ xp: number, gold: number, items: string[], leveledUp: boolean, newLevel: number }} rewards
 */
function _mountVictoryModal(rewards) {
  document.querySelector("#victory-modal")?.remove();

  // Build items HTML
  const itemsHtml =
    rewards.items.length > 0
      ? `<ul class="vic-items">${rewards.items.map((i) => `<li>🗂️ ${i}</li>`).join("")}</ul>`
      : `<p class="vic-no-loot">No items dropped.</p>`;

  const levelUpHtml = rewards.leveledUp
    ? `<div class="vic-level-up">⬆️ Level Up — you are now <strong>Level ${rewards.newLevel}</strong>!</div>`
    : "";

  const modal = document.createElement("div");
  modal.id = "victory-modal";
  modal.className = "victory-modal-overlay";
  modal.innerHTML = `
    <div class="victory-modal-card">
      <div class="vic-header">
        <span class="vic-sword">⚔️</span>
        <h2 class="vic-title">Victory!</h2>
        <span class="vic-sword">⚔️</span>
      </div>

      ${levelUpHtml}

      <div class="vic-rewards">
        ${rewards.xp > 0 ? `<div class="vic-reward-row"><span class="vic-label">⭐ Experience</span><span class="vic-value">+${rewards.xp} XP</span></div>` : ""}
        ${rewards.gold > 0 ? `<div class="vic-reward-row"><span class="vic-label">🪙 Gold</span><span class="vic-value">+${rewards.gold} gp</span></div>` : ""}
      </div>

      <div class="vic-loot">
        <p class="vic-loot-title">🐍 Loot</p>
        ${itemsHtml}
      </div>

      <button id="vic-continue-btn" class="btn-primary vic-continue-btn">Continue ▶</button>
    </div>
  `;

  // Log a triumphant win entry to the combat log before HUD unmounts
  appendCombatLog("✨ VICTORY — all enemies defeated!");

  document.body.appendChild(modal);

  modal.querySelector("#vic-continue-btn").addEventListener("click", () => {
    modal.classList.add("victory-modal--exit");
    modal.addEventListener(
      "animationend",
      () => {
        modal.remove();
        // Trigger DM narration now that the modal is gone
        const dmLabel =
          _pendingDmLabel ?? "The combat is over. I stand victorious.";
        _pendingDmLabel = null;
        processTurn(dmLabel);
      },
      { once: true },
    );
  });
}
