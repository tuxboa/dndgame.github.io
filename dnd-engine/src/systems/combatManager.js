/**
 * combatManager.js — Groq-powered Tactical Enemy AI
 *
 * Drives enemy turns with strategic decision-making from an LLM.
 *
 * TURN FLOW
 * ──────────────────────────────────────────────────────────────────
 *  1. Build a compact board-state description (grid, HP, positions).
 *  2. Ask Groq for a tactical move+action decision as JSON.
 *  3. Execute the response in order:
 *       a. Move token to move_to (fires COMBAT_MAP_MOVE → map engine animates)
 *       b. Log narration_hu to the combat log (Hungarian, shown on screen)
 *       c. Speak narration_en via GCP TTS (English, Wizard voice)
 *       d. Execute attack if action === "attack" and in range
 *  4. End the turn via advanceTurn().
 *
 * FALLBACK
 * If Groq is unavailable (no key, rate-limit, network error) the system
 * silently falls back to the deterministic move-and-attack logic.
 *
 * EXPORTS
 * ──────────────────────────────────────────────────────────────────
 *  runAITurn(enemy, thinkMs?)  Run one enemy AI turn.
 */

import { gameStore } from "../store/index.js";
import { eventBus, EVENTS } from "../engine/eventBus.js";
import { getGroqKey } from "../config/apiConfig.js";
import {
  moveParticipant,
  calcDistance,
  advanceTurn,
  endCombat,
  logCombatAction,
  applyDamage,
  applyStatusEffect,
  handlePlayerKnockout,
} from "./turnManager.js";
import { resolveAttackDamageAsync } from "./combatDamagePipeline.js";
import { roll } from "./diceSystem.js";
import { speakCombatLine } from "./audioSystem.js";

// ── Groq config (shared key via dmController) ─────────────────────────────────

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

/** Retrieve the active Groq key from localStorage via apiConfig. */
function _getApiKey() {
  return getGroqKey();
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Execute one full enemy AI turn: think → move → narrate → attack/pass.
 *
 * @param {import('./turnManager.js').CombatParticipant} enemy  The active enemy (from turn order)
 * @param {number} [thinkMs=800]  Pre-action delay so the turn doesn't resolve instantly
 */
export async function runAITurn(enemy, thinkMs = 800) {
  const state = gameStore.getState();
  if (!state.combat.active) return;

  // ── Think pause ───────────────────────────────────────────────────────────
  await new Promise((r) => setTimeout(r, thinkMs));
  if (!gameStore.getState().combat.active) return;

  // ── Refresh positions from store (may have changed since dispatch) ────────
  const turnOrder = gameStore.getState().combat.turnOrder;
  const live = turnOrder.filter((p) => (p.hp ?? 0) > 0);
  const enemyNow = live.find((p) => p.id === enemy.id);
  // Bug fix: use full turnOrder for player lookup so that a player at 0 HP
  // (death saves active) is still found — allowing _resolveAttack to add
  // death save failures when enemies attack an unconscious player.
  const player =
    live.find((p) => p.isPlayer) ?? turnOrder.find((p) => p.isPlayer);

  if (!enemyNow || !player) {
    advanceTurn();
    return;
  }

  // ── Try Groq AI ───────────────────────────────────────────────────────────
  let aiDecision = null;
  const apiKey = _getApiKey();

  if (apiKey) {
    try {
      aiDecision = await _queryGroq(enemyNow, player, live, apiKey);
    } catch (err) {
      console.warn(
        "[CombatManager] Groq AI failed — using fallback:",
        err.message,
      );
    }
  }

  // Bug fix: wrap execution in try/catch so any unexpected error in
  // _executeAIDecision / _executeFallbackTurn still advances the turn
  // instead of freezing combat permanently.
  try {
    if (aiDecision) {
      await _executeAIDecision(aiDecision, enemyNow, player);
    } else {
      await _executeFallbackTurn(enemyNow, player);
    }
  } catch (err) {
    console.error(
      "[CombatManager] Enemy turn crashed — forcing advanceTurn:",
      err,
    );
    advanceTurn();
  }
}

// ── Groq integration ──────────────────────────────────────────────────────────

/**
 * Build a board-state prompt and call Groq for a tactical decision.
 *
 * @param {object} enemy      Active enemy (live, from turn order)
 * @param {object} player     Player (live, from turn order)
 * @param {object[]} allLive  All living combatants
 * @param {string} apiKey
 * @returns {Promise<AIDecision>}
 */
async function _queryGroq(enemy, player, allLive, apiKey) {
  const { cols = 20, rows = 14 } = gameStore.getState().combat.map ?? {};
  const moveSpeed = enemy.movementSpeed ?? 30;
  const moveSq = Math.floor(moveSpeed / 5);
  const weaponRange = enemy.weaponRange ?? 1;
  const currentDist = calcDistance(enemy, player);
  const hpPct = Math.round((enemy.hp / enemy.maxHp) * 100);

  // Other living enemies (for flanking hints)
  const allies = allLive.filter((p) => !p.isPlayer && p.id !== enemy.id);
  const allyDesc =
    allies.length > 0
      ? allies
          .map((a) => `– ${a.name} at [${a.x},${a.y}], HP ${a.hp}/${a.maxHp}`)
          .join("\n")
      : "None";

  const systemPrompt = [
    "You are the tactical AI controller for a D&D 5e turn-based combat game.",
    "Your job: decide the optimal move and action for an enemy combatant this turn.",
    "Respond ONLY with a single JSON object — no markdown, no explanation, just JSON.",
    "",
    "JSON schema (strict):",
    "{",
    '  "move_to": [x, y] | null,',
    '  "action": "attack" | "move" | "defend",',
    '  "narration_hu": "Magyar szöveg a harcnaplóhoz (1-2 légköri mondat, jelen idő)",',
    '  "narration_en": "English TTS narration (1-2 sentences, vivid, wizard storyteller tone)"',
    "}",
    "",
    "move_to rules:",
    `– Must be within ${moveSq} squares of current position (movement budget: ${moveSpeed} ft).`,
    "– Must not be occupied by another combatant.",
    "– Use null to stay in place.",
    `– After moving, the enemy must be within ${weaponRange} square(s) of the player to use action: attack.`,
    "",
    "Tactical priorities:",
    `– HP is ${hpPct}% — if below 30%: strongly consider retreating (move away) and set action to "move" or "defend".`,
    weaponRange === 1
      ? "– Melee enemy: close the gap to get adjacent to the player (distance 1)."
      : `– Ranged enemy: maintain ~${Math.max(2, weaponRange - 2)} squares from player for optimal fire; don't close to melee unless forced.`,
    allies.length > 0
      ? "– Flanking: try to approach from a different diagonal than your allies."
      : "",
    "",
    "narration guidance:",
    "– narration_hu: casual Hungarian, present tense, no player name, 1-2 sentences describing the enemy's action.",
    "– narration_en: same action in English, atmospheric/dramatic, suitable for a deep British wizard TTS voice.",
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = JSON.stringify({
    grid: `${cols}×${rows}`,
    enemy: {
      name: enemy.name,
      position: [enemy.x, enemy.y],
      hp: `${enemy.hp}/${enemy.maxHp}`,
      movementBudget: `${moveSpeed} ft (${moveSq} sq)`,
      weaponRange: `${weaponRange} sq`,
      attackBonus: `+${enemy.attackBonus ?? 0}`,
    },
    player: {
      name: player.name,
      position: [player.x, player.y],
      hp: `${player.hp}/${player.maxHp}`,
      ac: player.ac,
    },
    distanceToPlayer: currentDist,
    alliesAlive: allyDesc,
  });

  const body = {
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
    max_tokens: 256,
    temperature: 0.75,
  };

  // 8-second timeout — if Groq hangs, abort and fall back to deterministic AI
  // so the enemy turn never stalls combat indefinitely.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res;
  try {
    res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq ${res.status}: ${errText.slice(0, 120)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty Groq response");

  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error(`Malformed Groq JSON response: ${parseErr.message}`, {
      cause: parseErr,
    });
  }

  // Sanity-check the response shape
  if (
    !("action" in parsed) ||
    !("narration_hu" in parsed) ||
    !("narration_en" in parsed)
  ) {
    throw new Error("Malformed AI response — missing required fields");
  }

  return parsed;
}

// ── Execution phases ──────────────────────────────────────────────────────────

/**
 * Execute the AI's parsed decision: move → narrate → attack/pass.
 *
 * @param {AIDecision} decision
 * @param {object}     enemy     Snapshot before this turn's move
 * @param {object}     player
 */
async function _executeAIDecision(decision, enemy, player) {
  const { cols = 20, rows = 14 } = gameStore.getState().combat.map ?? {};

  // ── 1. Move phase ─────────────────────────────────────────────────────────
  if (Array.isArray(decision.move_to) && decision.move_to.length === 2) {
    const [tx, ty] = decision.move_to;
    const destX = Math.max(0, Math.min(cols - 1, Math.round(tx)));
    const destY = Math.max(0, Math.min(rows - 1, Math.round(ty)));

    const moved = moveParticipant(enemy.id, destX, destY);
    if (!moved.ok) {
      // Destination rejected (occupied / out of budget) — try 1-step toward player
      _nudgeTowardPlayer(enemy, player);
    }

    // Small pause so the map animation is visible before narration starts
    await new Promise((r) => setTimeout(r, 350));
  }

  // ── 2. Narration phase — pick language for log, English always goes to TTS ─────
  if (decision.narration_hu || decision.narration_en) {
    const lang = gameStore.getState().settings?.language ?? "hu";
    const narText =
      lang === "en"
        ? (decision.narration_en ?? decision.narration_hu ?? "")
        : (decision.narration_hu ?? "");
    if (narText) {
      logCombatAction({
        actor: enemy.name,
        action: "—",
        result: narText,
      });
    }
  }

  // Only speak for attacks or when the enemy is badly wounded — skip routine movement narration
  const _hpPct = enemy?.hp && enemy?.maxHp ? enemy.hp / enemy.maxHp : 1;
  const _shouldSpeak = decision.action === "attack" || _hpPct <= 0.3;
  if (decision.narration_en && _shouldSpeak) {
    // Fire and forget — turn execution doesn't wait for audio to finish
    speakCombatLine(decision.narration_en).catch(() => {});
  }

  // ── 3. Action phase ───────────────────────────────────────────────────────
  if (decision.action === "attack") {
    // Re-read positions after move
    const turnOrder = gameStore.getState().combat.turnOrder;
    const updatedEnemy = turnOrder.find((p) => p.id === enemy.id);
    const updatedPlayer = turnOrder.find((p) => p.isPlayer) ?? player;
    const weaponRange = updatedEnemy?.weaponRange ?? enemy.weaponRange ?? 1;
    const dist = calcDistance(updatedEnemy ?? enemy, updatedPlayer);

    if (dist <= weaponRange) {
      await _resolveAttack(updatedEnemy ?? enemy);
      return; // advanceTurn called inside _resolveAttack
    } else {
      // AI said attack but couldn't close — log it
      logCombatAction({
        actor: enemy.name,
        action: "tries to attack",
        result: "Out of reach this turn — unable to strike.",
      });
    }
  }

  advanceTurn();
}

/**
 * Roll and apply one attack: to-hit, damage, advance turn.
 * Player state is read fresh from the store to ensure up-to-date HP/AC.
 *
 * @param {object} enemy
 */
async function _resolveAttack(enemy) {
  const state = gameStore.getState();
  const latestPlayer = state.player; // most up-to-date HP

  // ── D&D 5e: attacking an unconscious player ───────────────────────────────
  // Hitting an unconscious creature is an auto-crit → 2 death save failures
  // instead of dealing HP damage.   Reset prevention: never call handlePlayerKnockout
  // again while deathSaveActive is true.
  if (latestPlayer.deathSaveActive) {
    const saves = {
      successes: latestPlayer.deathSaves?.successes ?? 0,
      failures: Math.min(3, (latestPlayer.deathSaves?.failures ?? 0) + 2),
    };
    gameStore.setState(
      { player: { ...latestPlayer, deathSaves: saves } },
      "combatManager:attackWhileUnconscious",
    );
    logCombatAction({
      actor: enemy.name,
      action: "strikes the unconscious player (auto-crit!)",
      result: `2 death save failures (${saves.failures}/3)`,
    });
    // Sync pip display if the overlay exists
    const overlay = document.querySelector("#death-save-overlay");
    if (overlay) {
      overlay.querySelectorAll("#ds-failures .ds-pip").forEach((pip, i) => {
        pip.classList.toggle("ds-pip--filled", i < saves.failures);
      });
      const resultEl = overlay.querySelector("#ds-result");
      if (resultEl)
        resultEl.textContent = `${enemy.name} strikes! 2 death save failures.`;
    }
    if (saves.failures >= 3) {
      // Player dies — end combat after a moment
      const dsBtn = document.querySelector("#ds-roll-btn");
      if (dsBtn) dsBtn.remove();
      const title = overlay?.querySelector(".ds-title");
      if (title) title.textContent = "💀 YOUR CHARACTER HAS DIED";
      await new Promise((r) => setTimeout(r, 1800));
      overlay?.remove();
      endCombat();
      return;
    }
    advanceTurn();
    return;
  }

  // ── Attack roll: apply advantage / disadvantage from status effects ─────────
  const enemyCombatant = state.combat.turnOrder.find((p) => p.id === enemy.id);
  const enemyEffects = enemyCombatant?.activeEffects ?? [];
  // Enemy is disadvantaged when frightened, blinded, or prone (D&D 5e)
  const enemyDisadv = enemyEffects.some(
    (e) => e.id === "frightened" || e.id === "blinded" || e.id === "prone",
  );
  const playerDodging = latestPlayer.dodging ?? false;
  // Enemy has advantage when the target (player) is blinded or prone (D&D 5e)
  const playerCombatant = state.combat.turnOrder.find((p) => p.isPlayer);
  const playerEffects = playerCombatant?.activeEffects ?? [];
  const enemyHasAdv = playerEffects.some(
    (e) => e.id === "blinded" || e.id === "prone",
  );
  // Advantage and disadvantage cancel out (D&D 5e rule)
  const hasDisadv = (enemyDisadv || playerDodging) && !enemyHasAdv;
  const hasAdv = enemyHasAdv && !enemyDisadv && !playerDodging;

  const attackBonus = enemy.attackBonus ?? 0;
  const atkBonusStr = attackBonus >= 0 ? `+${attackBonus}` : `${attackBonus}`;
  const atkNotation = hasDisadv
    ? `2d20kl1${atkBonusStr}`
    : hasAdv
      ? `2d20kh1${atkBonusStr}`
      : attackBonus >= 0
        ? `1d20+${attackBonus}`
        : `1d20-${Math.abs(attackBonus)}`;
  const attackRoll = roll(atkNotation);
  if (hasDisadv || hasAdv) {
    const cause = hasAdv
      ? playerEffects.find((e) => e.id === "blinded" || e.id === "prone")?.id
      : (enemyEffects.find(
          (e) =>
            e.id === "frightened" || e.id === "blinded" || e.id === "prone",
        )?.id ?? "player dodging");
    logCombatAction({
      actor: enemy.name,
      action: `attacks at ${hasAdv ? "Advantage" : "Disadvantage"}`,
      result: `Cause: ${cause}`,
    });
  }
  eventBus.emit(EVENTS.DICE_ANIMATE, {
    notation: atkNotation,
    result: attackRoll,
  });
  // Use the KEPT die (used[0]) so a dropped nat-20 on disadvantage roll
  // does not falsely trigger a critical hit on the player.
  const usedDie = attackRoll.used?.[0] ?? attackRoll.dice[0];
  const hit = usedDie === 20 || attackRoll.total >= latestPlayer.ac;
  const crit = usedDie === 20;

  if (!hit) {
    logCombatAction({
      actor: enemy.name,
      action: "attacks you",
      result: `Miss (rolled ${attackRoll.total} vs your AC ${latestPlayer.ac})`,
    });
    eventBus.emit(EVENTS.COMBAT_MISS, { attacker: enemy.name });
    advanceTurn();
    return;
  }

  const baseDmgNotation = enemy.damageDie ?? "1d6";
  // On crit, double the dice count (D&D 5e rule)
  const critDmgNotation = baseDmgNotation.replace(
    /^(\d+)d(\d+)/,
    (_, n, d) => `${parseInt(n) * 2}d${d}`,
  );
  const dmgNotation = crit ? critDmgNotation : baseDmgNotation;
  const dmgRoll = roll(dmgNotation);
  eventBus.emit(EVENTS.DICE_ANIMATE, {
    notation: dmgNotation,
    result: dmgRoll,
  });
  const bonus = enemy.baseDmg ?? 0;
  // D&D 5e: on a crit only the dice are doubled, bonus modifier is added once.
  const totalDmg = dmgRoll.total + bonus;

  const resolvedDamage = await resolveAttackDamageAsync(
    {
      targetId: latestPlayer.id ?? "player",
      targetIsPlayer: true,
      amount: totalDmg,
      isCritical: crit,
      damageType: enemy.damageType ?? "physical",
      extraReduction: 0,
    },
    {},
  );
  const finalDamage = resolvedDamage.amount;

  // applyDamage updates BOTH state.player.hp AND combat.turnOrder[player].hp
  // — keeps the HP bar, the alive-check, and the log value all in sync.
  applyDamage(latestPlayer.id ?? "player", finalDamage, {
    isCrit: crit,
    damageType: enemy.damageType ?? "physical",
    useDamagePipeline: false,
  });

  // ── On-Hit status effects (e.g. Giant Spider poison) ─────────────────────
  if (enemy.onHit && Math.random() < (enemy.onHit.chance ?? 0)) {
    const playerId = latestPlayer.id ?? "player";
    const effect = {
      id: (enemy.onHit.status ?? "poison").toLowerCase(),
      duration: enemy.onHit.duration ?? 2,
    };
    applyStatusEffect(playerId, effect);
    logCombatAction({
      actor: enemy.name,
      action: "applies",
      result: `${enemy.onHit.status}! (${effect.duration} turns)`,
    });
  }

  // Read the authoritative post-damage HP from the store
  const newHp = gameStore.getState().player.hp;

  eventBus.emit(EVENTS.PLAYER_DAMAGED, {
    damage: finalDamage,
    newHp,
    source: enemy.name,
    crit,
  });

  logCombatAction({
    actor: enemy.name,
    action: `attacks you${crit ? " (CRIT!)" : ""}`,
    result: `Hit for ${finalDamage} damage — you have ${newHp}/${latestPlayer.maxHp} HP remaining`,
  });

  if (newHp === 0) {
    handlePlayerKnockout();
    // ── DEATH SAVE PAUSE ──
    // Player has dropped to 0 HP. We intentionally DO NOT call advanceTurn() here.
    // This fully pauses the combat loop (stopping all enemies) until the player
    // either stabilises or dies, ensuring the death-save sequence is an uninterrupted mini-game.
    return;
  }

  advanceTurn();
}

/**
 * Deterministic fallback turn — simple move-toward + attack.
 * Used when Groq is unavailable.
 *
 * @param {object} enemy
 * @param {object} player
 */
async function _executeFallbackTurn(enemy, player) {
  const weaponRange = enemy.weaponRange ?? 1;
  const initialTurnOrder = gameStore.getState().combat.turnOrder;
  const initialPlayer = initialTurnOrder.find((p) => p.isPlayer) ?? player;

  let dist = calcDistance(enemy, initialPlayer);
  let updated = null;

  if (dist > weaponRange) {
    _nudgeTowardPlayer(enemy, player);

    const turnOrder = gameStore.getState().combat.turnOrder;
    updated = turnOrder.find((p) => p.id === enemy.id) ?? null;
    const updatedPlayer = turnOrder.find((p) => p.isPlayer) ?? player;

    if (updated) {
      dist = calcDistance(updated, updatedPlayer);
    }
  }

  if (dist > weaponRange) {
    logCombatAction({
      actor: enemy.name,
      action: "moves toward you",
      result: "Out of reach — unable to attack this turn.",
    });
    advanceTurn();
    return;
  }

  // Use the updated (post-move) snapshot if available
  await _resolveAttack(updated ?? enemy);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Move one enemy one diagonal step toward the target (respects budget).
 * Used when the AI's exact destination is rejected.
 *
 * @param {object} enemy
 * @param {object} target
 */
function _nudgeTowardPlayer(enemy, target) {
  const { cols = 20, rows = 14 } = gameStore.getState().combat.map ?? {};
  const moveSq = Math.floor((enemy.movementRemaining ?? 0) / 5);
  if (moveSq === 0) return;

  const turnOrder = gameStore.getState().combat.turnOrder;
  const liveTarget =
    turnOrder.find((p) => p.id === target.id) ??
    turnOrder.find((p) => p.isPlayer) ??
    target;

  const weaponRange = enemy.weaponRange ?? 1;
  const dist = calcDistance(enemy, liveTarget);
  if (dist <= weaponRange) return;

  const steps = Math.min(moveSq, dist - weaponRange);
  const dx = Math.sign(liveTarget.x - enemy.x);
  const dy = Math.sign(liveTarget.y - enemy.y);
  const tx = Math.max(0, Math.min(cols - 1, enemy.x + dx * steps));
  const ty = Math.max(0, Math.min(rows - 1, enemy.y + dy * steps));

  if (tx === enemy.x && ty === enemy.y) return;

  const result = moveParticipant(enemy.id, tx, ty);
  if (!result.ok) {
    // Orthogonal fallbacks
    for (const [fx, fy] of [
      [Math.max(0, Math.min(cols - 1, enemy.x + dx * steps)), enemy.y],
      [enemy.x, Math.max(0, Math.min(rows - 1, enemy.y + dy * steps))],
    ]) {
      if (fx === enemy.x && fy === enemy.y) continue;
      if (moveParticipant(enemy.id, fx, fy).ok) break;
    }
  }
}

/**
 * @typedef {Object} AIDecision
 * @property {[number, number] | null} move_to    Target grid cell, or null to stay put
 * @property {"attack"|"move"|"defend"} action    What to do after moving
 * @property {string} narration_hu                Hungarian text for the combat log
 * @property {string} narration_en                English text for TTS
 */
