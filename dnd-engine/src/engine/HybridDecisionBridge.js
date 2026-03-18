import { eventBus, EVENTS } from "./eventBus.js";
import { campaignManager } from "./CampaignManager.js";
import { gameStore } from "../store/index.js";
import { geminiDMService } from "../services/GeminiDMService.js";
import { addItem, modifyGold } from "../systems/inventorySystem.js";
import { addXp } from "../systems/levelUpSystem.js";
import { timeManager } from "../systems/timeManager.js";
import { factionManager } from "../systems/factionManager.js";

let _initialized = false;

function _appendNarrative(role, text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return;

  const dm = gameStore.getState().dm;
  gameStore.setState(
    {
      dm: {
        ...dm,
        narrativeLog: [
          ...dm.narrativeLog,
          { role, text: trimmed, timestamp: Date.now() },
        ],
      },
    },
    "hybridDecisionBridge:appendNarrative",
  );
}

function _setPending(pending, context = null) {
  const dm = gameStore.getState().dm;

  gameStore.setState(
    {
      dm: {
        ...dm,
        pendingResponse: pending,
        lastContext: context ?? dm.lastContext,
      },
    },
    pending
      ? "hybridDecisionBridge:pendingOn"
      : "hybridDecisionBridge:pendingOff",
  );
}

function _setAwaitingRoll(awaitingRoll) {
  const dm = gameStore.getState().dm;

  gameStore.setState(
    {
      dm: {
        ...dm,
        awaitingRoll,
      },
    },
    awaitingRoll
      ? "hybridDecisionBridge:awaitingRollOn"
      : "hybridDecisionBridge:awaitingRollOff",
  );
}

function _incrementTurnCount() {
  const dm = gameStore.getState().dm;
  gameStore.setState(
    {
      dm: {
        ...dm,
        turnCount: (dm.turnCount ?? 0) + 1,
      },
    },
    "hybridDecisionBridge:turnCount",
  );
}

function _buildContext(playerInput, payload = {}) {
  const worldState = campaignManager.getWorldState();
  const sceneContext =
    payload.sceneContext ?? campaignManager.getCurrentSceneContext?.() ?? null;
  const currentScene = campaignManager.getCurrentScene?.() ?? null;

  const sceneChoices = Array.isArray(currentScene?.choices)
    ? currentScene.choices
        .map((choice) =>
          String(choice?.text ?? choice?.label ?? "").trim(),
        )
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const time = worldState?.time ?? { day: 1, hour: 8, minute: 0 };
  const timeOfDay = timeManager.getTimeOfDay(time);
  const worldTimeLabel = timeManager.getCurrentTimeLabel();

  return {
    playerInput,
    source: payload.source ?? "unknown",
    worldTimeLabel,
    worldState: {
      flags: worldState?.flags ?? {},
      variables: worldState?.variables ?? {},
      npcAffinity: worldState?.npcAffinity ?? {},
      time,
      timeOfDay,
      factions: worldState?.factions ?? {},
    },
    currentScene: {
      sceneId:
        sceneContext?.sceneId ?? campaignManager.currentSceneId ?? "unknown",
      type: currentScene?.type ?? sceneContext?.type ?? "narrative",
      text: String(currentScene?.text ?? sceneContext?.context ?? "").trim(),
      encounterId: String(currentScene?.encounterId ?? "").trim(),
      onLeave: String(currentScene?.onLeave ?? sceneContext?.onLeave ?? "").trim(),
      choices: sceneChoices,
    },
  };
}

function _toFlagPatch(flagChanges) {
  const patch = {};

  if (Array.isArray(flagChanges)) {
    flagChanges.forEach((entry) => {
      if (typeof entry === "string") {
        const key = entry.trim();
        if (key) patch[key] = true;
        return;
      }

      if (!entry || typeof entry !== "object") return;
      const key = String(entry.key ?? entry.flag ?? entry.name ?? "").trim();
      if (!key) return;

      const rawValue = entry.value;
      patch[key] =
        typeof rawValue === "boolean"
          ? rawValue
          : String(rawValue ?? "").toLowerCase() === "true";
    });

    return patch;
  }

  if (flagChanges && typeof flagChanges === "object") {
    Object.entries(flagChanges).forEach(([key, value]) => {
      patch[key] =
        typeof value === "boolean"
          ? value
          : String(value ?? "").toLowerCase() === "true";
    });
  }

  return patch;
}

function _toVariablePatch(variableChanges) {
  const patch = {};

  if (Array.isArray(variableChanges)) {
    variableChanges.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const key = String(entry.key ?? entry.variable ?? entry.name ?? "").trim();
      if (!key) return;
      patch[key] = entry.value;
    });

    return patch;
  }

  if (variableChanges && typeof variableChanges === "object") {
    Object.assign(patch, variableChanges);
  }

  return patch;
}

function _normaliseDecision(rawDecision = {}) {
  const decision = rawDecision && typeof rawDecision === "object" ? rawDecision : {};
  const logic = decision.logic && typeof decision.logic === "object" ? decision.logic : {};

  const transition = String(decision.transition ?? "STORY")
    .trim()
    .toUpperCase();

  const rawTimeDelta = decision.timeDelta ?? logic.timeDelta;
  const rawFactionUpdates = decision.factionUpdates ?? logic.factionUpdates;
  const rawAudioProfile = decision.audioProfile ?? logic.audioProfile;

  return {
    narration: String(decision.narration ?? "").trim(),
    audioCue: String(decision.audioCue ?? "").trim(),
    audioOutput:
      typeof decision.audioOutput === "string" ? decision.audioOutput : null,
    logic: {
      flags: logic.flags ?? [],
      variables: logic.variables ?? [],
    },
    transition: transition === "COMBAT" ? "COMBAT" : "STORY",
    nextSceneId: String(decision.nextSceneId ?? "").trim(),
    encounterId: String(decision.encounterId ?? "").trim(),
    skillCheck: _normaliseSkillCheck(decision.skillCheck),
    rewards: _normaliseRewards(decision.rewards),
    affinityUpdate: _normaliseAffinityUpdate(decision.affinityUpdate),
    timeDelta: _normaliseTimeDelta(rawTimeDelta),
    factionUpdates: _normaliseFactionUpdates(rawFactionUpdates),
    audioProfile: _normaliseAudioProfile(rawAudioProfile),
  };
}

function _normaliseTimeDelta(rawTimeDelta) {
  const raw = Number(rawTimeDelta);
  if (!Number.isFinite(raw)) return 5;
  return Math.max(0, Math.min(24 * 60, Math.floor(raw)));
}

function _normaliseFactionUpdates(rawFactionUpdates) {
  if (!Array.isArray(rawFactionUpdates)) return [];

  return rawFactionUpdates
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const faction = String(entry.faction ?? "").trim();
      const deltaRaw = Number(entry.delta);
      const delta = Number.isFinite(deltaRaw) ? Math.round(deltaRaw) : 0;
      if (!faction || delta === 0) return null;

      return {
        faction,
        delta,
      };
    })
    .filter(Boolean);
}

function _normaliseAudioProfile(rawAudioProfile) {
  if (!rawAudioProfile || typeof rawAudioProfile !== "object") return null;

  const ambient = String(rawAudioProfile.ambient ?? "").trim();
  const musicMood = String(rawAudioProfile.musicMood ?? "").trim();
  if (!ambient && !musicMood) return null;

  return {
    ambient,
    musicMood,
  };
}

function _normaliseSkillCheck(rawSkillCheck) {
  if (!rawSkillCheck || typeof rawSkillCheck !== "object") return null;

  const ability = _normaliseAbilityKey(rawSkillCheck.ability);
  const dcRaw = Number(rawSkillCheck.dc);
  const dc = Number.isFinite(dcRaw) ? Math.max(1, Math.floor(dcRaw)) : 10;
  const successScene = String(rawSkillCheck.successScene ?? "").trim();
  const failScene = String(rawSkillCheck.failScene ?? "").trim();

  if (!ability || !successScene || !failScene) return null;

  return {
    ability,
    dc,
    successScene,
    failScene,
  };
}

function _normaliseRewards(rawRewards) {
  if (!rawRewards || typeof rawRewards !== "object") return null;

  const xpRaw = Number(rawRewards.xp ?? 0);
  const goldRaw = Number(rawRewards.gold ?? 0);
  const xp = Number.isFinite(xpRaw) ? Math.max(0, Math.floor(xpRaw)) : 0;
  const gold = Number.isFinite(goldRaw) ? Math.max(0, Math.floor(goldRaw)) : 0;
  const items = Array.isArray(rawRewards.items)
    ? rawRewards.items
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    : [];

  if (!xp && !gold && items.length === 0) return null;

  return {
    xp,
    gold,
    items,
  };
}

function _normaliseAffinityUpdate(rawAffinityUpdate) {
  if (!rawAffinityUpdate || typeof rawAffinityUpdate !== "object") return null;

  const npcId = String(rawAffinityUpdate.npcId ?? "").trim();
  const deltaRaw = Number(rawAffinityUpdate.delta);
  const delta = Number.isFinite(deltaRaw) ? Math.round(deltaRaw) : 0;

  if (!npcId || delta === 0) return null;

  return {
    npcId,
    delta,
  };
}

function _normaliseAbilityKey(ability) {
  const raw = String(ability ?? "").trim().toLowerCase();
  if (!raw) return "dex";

  const mapping = {
    strength: "str",
    str: "str",
    dexterity: "dex",
    dex: "dex",
    constitution: "con",
    con: "con",
    intelligence: "int",
    int: "int",
    wisdom: "wis",
    wis: "wis",
    charisma: "cha",
    cha: "cha",
  };

  return mapping[raw] ?? "dex";
}

function _buildFallbackDecision(context) {
  const input = String(context.playerInput ?? "").toLowerCase();
  const shouldFight =
    input.includes("attack") || input.includes("fight") || input.includes("támad");

  return {
    narration: "A világ hallgat egy szívdobbanásnyi ideig, majd reagál a döntésedre.",
    audioCue: "A DM hangja mélyen visszhangzik a romok között.",
    logic: {
      flags: [],
      variables: [],
    },
    transition: shouldFight ? "COMBAT" : "STORY",
    nextSceneId: "",
    encounterId: shouldFight ? context.currentScene?.encounterId ?? "" : "",
    skillCheck: null,
    rewards: null,
    affinityUpdate: null,
    timeDelta: 5,
    factionUpdates: [],
    audioProfile: {
      ambient:
        context.worldState?.timeOfDay === "Night"
          ? "Éjszakai szélzúgás"
          : "Nappali utcazaj",
      musicMood: shouldFight ? "battle" : "mystery",
    },
  };
}

function _emitCombatLogMessage(text) {
  const message = String(text ?? "").trim();
  if (!message) return;

  eventBus.emit(EVENTS.NARRATION_RECEIVED, {
    text: message,
    color: "#9CA3AF",
  });
}

function _emitDecisionNarration(decision) {
  if (!decision?.narration) return;

  _appendNarrative("dm", decision.narration);
  eventBus.emit(EVENTS.NARRATION_RECEIVED, {
    text: decision.narration,
    color: "gold",
  });
}

function _emitDecisionAudio(decision) {
  if (!decision?.audioCue && !decision?.audioOutput) return;

  eventBus.emit(EVENTS.DM_AUDIO_OUTPUT_READY, {
    audioCue: decision.audioCue,
    audioOutput: decision.audioOutput,
  });

  void geminiDMService?.playCyborgAudio?.({
    audioCue: decision.audioCue,
    audioOutput: decision.audioOutput,
  });
}

function _applyLogic(logic = {}) {
  const flagPatch = _toFlagPatch(logic.flags ?? []);
  const variablePatch = _toVariablePatch(logic.variables ?? []);

  if (Object.keys(flagPatch).length || Object.keys(variablePatch).length) {
    campaignManager.updateState({
      flags: flagPatch,
      variables: variablePatch,
    });
  }
}

function _applyWorldDynamics(decision, context = {}, source = "hybrid") {
  const timeDelta = Number(decision?.timeDelta ?? 0);
  if (Number.isFinite(timeDelta) && timeDelta > 0) {
    const timeResult = timeManager.advanceTime(timeDelta, {
      source: "hybrid-decision-bridge",
      reason: source,
    });

    if (timeResult?.deltaMinutes) {
      _emitCombatLogMessage(
        `[RENDSZER]: ${timeResult.deltaMinutes} perc telt el. Jelenlegi idő: ${campaignManager.describeCurrentTime()}.`,
      );
    }
  }

  const factionUpdates = Array.isArray(decision?.factionUpdates)
    ? decision.factionUpdates
    : [];

  if (factionUpdates.length) {
    const applied = factionManager.applyFactionUpdates(factionUpdates, {
      source: "hybrid-decision-bridge",
      reason: source,
    });

    applied.forEach((update) => {
      _emitCombatLogMessage(
        `[RENDSZER]: ${update.faction} reputáció ${update.delta >= 0 ? "+" : ""}${update.delta} (${update.previousValue} → ${update.newValue}).`,
      );
    });
  }

  if (decision?.audioProfile) {
    eventBus.emit(EVENTS.AUDIO_PROFILE_SUGGESTED, {
      ...decision.audioProfile,
      source,
      scene: context.currentScene ?? null,
    });
  }
}

function _toItemId(name) {
  return String(name ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function _normaliseRewardItem(itemName) {
  const raw = String(itemName ?? "").trim();
  if (!raw) return null;

  const quantityMatch = raw.match(/^(.*?)(?:\s*[x×]\s*(\d+))?$/i);
  const name = String(quantityMatch?.[1] ?? raw).trim();
  const quantityRaw = Number(quantityMatch?.[2] ?? 1);
  const quantity =
    Number.isFinite(quantityRaw) && quantityRaw > 0
      ? Math.floor(quantityRaw)
      : 1;

  if (!name) return null;

  return {
    itemId: _toItemId(name),
    name,
    quantity,
  };
}

function _applyRewards(rewards, source = "hybrid") {
  if (!rewards) return;

  const xp = Number(rewards.xp ?? 0);
  if (Number.isFinite(xp) && xp > 0) {
    addXp(Math.floor(xp));
    _emitCombatLogMessage(`[RENDSZER]: Kaptál ${Math.floor(xp)} XP-t!`);
  }

  const gold = Number(rewards.gold ?? 0);
  if (Number.isFinite(gold) && gold > 0) {
    modifyGold(Math.floor(gold));
    _emitCombatLogMessage(`[RENDSZER]: Kaptál ${Math.floor(gold)} aranyat!`);
  }

  const items = Array.isArray(rewards.items) ? rewards.items : [];
  items.forEach((itemName) => {
    const rewardItem = _normaliseRewardItem(itemName);
    if (!rewardItem) return;

    addItem(rewardItem);
    _emitCombatLogMessage(
      `[RENDSZER]: Tárgy jutalom: ${rewardItem.name}${
        rewardItem.quantity > 1 ? ` ×${rewardItem.quantity}` : ""
      } (${source}).`,
    );
  });
}

function _humanizeNpcName(npcId) {
  return String(npcId ?? "NPC")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function _affinityBand(value) {
  if (value <= -40) return "hostile";
  if (value <= -10) return "suspicious";
  if (value < 10) return "neutral";
  if (value < 40) return "friendly";
  return "trusted";
}

function _affinityBandText(band) {
  switch (band) {
    case "hostile":
      return "ellenséges";
    case "suspicious":
      return "gyanakvó";
    case "friendly":
      return "barátságos";
    case "trusted":
      return "bizalmas";
    default:
      return "semleges";
  }
}

function _resolveAffinityUiLabel(previousBand, nextBand, delta) {
  if (nextBand !== previousBand) {
    if (delta > 0) return "Kedvezőbbé vált";
    if (delta < 0) return "Mérgesebbé vált";
  }

  if (delta > 0) return "Barátságosabb lett";
  if (delta < 0) return "Gyanakvóbb lett";
  return "Nem változott";
}

function _isSignificantAffinityShift(previousBand, nextBand, delta) {
  return previousBand !== nextBand || Math.abs(delta) >= 15;
}

function _applyAffinityUpdate(affinityUpdate) {
  if (!affinityUpdate) return null;

  const npcId = String(affinityUpdate.npcId ?? "").trim();
  if (!npcId) return null;

  const deltaRaw = Number(affinityUpdate.delta ?? 0);
  const delta = Number.isFinite(deltaRaw) ? Math.round(deltaRaw) : 0;
  if (!delta) return null;

  const worldState = campaignManager.getWorldState();
  const currentAffinity = worldState.npcAffinity ?? {};
  const previousValueRaw = Number(currentAffinity[npcId] ?? 0);
  const previousValue = Number.isFinite(previousValueRaw) ? previousValueRaw : 0;
  const newValue = Math.max(-100, Math.min(100, previousValue + delta));
  const appliedDelta = newValue - previousValue;

  if (appliedDelta === 0) return null;

  campaignManager.updateState({
    npcAffinity: {
      [npcId]: newValue,
    },
  });

  const previousBand = _affinityBand(previousValue);
  const nextBand = _affinityBand(newValue);
  const significant = _isSignificantAffinityShift(
    previousBand,
    nextBand,
    appliedDelta,
  );
  const npcName = _humanizeNpcName(npcId);
  const uiLabel = _resolveAffinityUiLabel(previousBand, nextBand, appliedDelta);

  const chronicleText =
    `${npcName} viszonya megváltozott: ` +
    `${_affinityBandText(previousBand)} → ${_affinityBandText(nextBand)} ` +
    `(${previousValue} → ${newValue}).`;

  const payload = {
    npcId,
    npcName,
    previousValue,
    newValue,
    delta: appliedDelta,
    previousBand,
    nextBand,
    significant,
    uiLabel,
    message: `${npcName}: [${uiLabel}]`,
    chronicleText,
  };

  eventBus.emit(EVENTS.NPC_AFFINITY_CHANGED, payload);

  if (significant) {
    _emitCombatLogMessage(`[RENDSZER]: ${chronicleText}`);
  }

  return payload;
}

async function _resolveOrGenerateSceneId(nextSceneId, context, reason = "") {
  const candidate = String(nextSceneId ?? "").trim();
  if (!candidate) return "";

  if (campaignManager.hasScene?.(candidate)) {
    return candidate;
  }

  _emitCombatLogMessage(
    `[RENDSZER]: A(z) "${candidate}" jelenet hiányzik — procedurális generálás indul...`,
  );

  const generatedScene = geminiDMService?.generateProceduralScene
    ? await geminiDMService.generateProceduralScene({
        context,
        requestedSceneId: candidate,
        reason,
      })
    : null;

  if (!generatedScene) {
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: `Nem sikerült új jelenetet generálni (${candidate}).`,
      type: "warning",
      ttl: 4200,
    });
    return "";
  }

  let generatedSceneId =
    String(generatedScene.sceneId ?? "").trim() ||
    `generated_scene_${Date.now()}`;

  if (campaignManager.hasScene?.(generatedSceneId)) {
    generatedSceneId = `${generatedSceneId}_${Date.now()}`;
  }

  const injected = campaignManager.injectTemporaryScene?.(generatedSceneId, {
    ...generatedScene,
    sceneId: generatedSceneId,
  });

  if (!injected) {
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: `A generált jelenet nem injektálható (${generatedSceneId}).`,
      type: "error",
      ttl: 4200,
    });
    return "";
  }

  eventBus.emit(EVENTS.UI_NOTIFICATION, {
    text: `🧩 Új jelenet generálva: ${generatedSceneId}`,
    type: "info",
    ttl: 3400,
  });

  _emitCombatLogMessage(
    `[RENDSZER]: Procedurális jelenet beillesztve: ${generatedSceneId}.`,
  );

  return generatedSceneId;
}

async function _applyTransition(decision, payload = {}, context = {}) {
  if (decision.transition === "COMBAT") {
    if (decision.encounterId) {
      eventBus.emit(EVENTS.COMBAT_TRIGGERED, {
        encounterId: decision.encounterId,
        source: payload.source ?? "hybrid-decision-bridge",
      });
    } else {
      eventBus.emit(EVENTS.UI_NOTIFICATION, {
        text: "A DM harcot jelzett, de hiányzik az encounterId.",
        type: "warning",
        ttl: 4200,
      });
    }

    return;
  }

  if (decision.nextSceneId) {
    const resolvedSceneId = await _resolveOrGenerateSceneId(
      decision.nextSceneId,
      context,
      "transition",
    );
    if (resolvedSceneId) {
      campaignManager.goToScene(resolvedSceneId);
      return resolvedSceneId;
    }
  }

  return "";
}

function _waitForSkillCheckResult(requestId, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const onResult = (payload = {}) => {
      if (payload.requestId !== requestId) return;

      clearTimeout(timeoutHandle);
      eventBus.off(EVENTS.DICE_ROLL_RESULT, onResult);
      resolve(payload);
    };

    const timeoutHandle = setTimeout(() => {
      eventBus.off(EVENTS.DICE_ROLL_RESULT, onResult);
      reject(new Error("Skill check dice roll timeout"));
    }, timeoutMs);

    eventBus.on(EVENTS.DICE_ROLL_RESULT, onResult, { priority: 150 });
  });
}

async function _runSkillCheckGate(skillCheck) {
  const requestId = `skill-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  _setAwaitingRoll(true);
  _emitCombatLogMessage(
    `[RENDSZER]: Képességpróba szükséges (${skillCheck.ability.toUpperCase()}, DC ${skillCheck.dc}).`,
  );

  eventBus.emit(EVENTS.DICE_ROLL_REQUESTED, {
    requestId,
    ability: skillCheck.ability,
    dc: skillCheck.dc,
    source: "hybrid-decision-bridge",
  });

  let rollPayload;

  try {
    rollPayload = await _waitForSkillCheckResult(requestId);
  } catch (error) {
    const fallbackTotal = Math.floor(Math.random() * 20) + 1;
    rollPayload = {
      requestId,
      ability: skillCheck.ability,
      dc: skillCheck.dc,
      total: fallbackTotal,
      success: fallbackTotal >= skillCheck.dc,
      source: "hybrid-timeout-fallback",
    };
    console.warn("[HybridDecisionBridge] Skill check timeout fallback:", error);
  } finally {
    _setAwaitingRoll(false);
  }

  const total = Number(rollPayload.total ?? rollPayload.result?.total ?? 0);
  const success = total >= skillCheck.dc;
  const targetSceneId = success ? skillCheck.successScene : skillCheck.failScene;

  return {
    requestId,
    ability: skillCheck.ability,
    dc: skillCheck.dc,
    total,
    success,
    targetSceneId,
  };
}

export async function processHybridTurn(payload = {}) {
  const text = String(payload.text ?? "").trim();
  if (!text) return null;

  if (gameStore.getState().dm.pendingResponse) return null;

  _appendNarrative("player", text);

  const context = _buildContext(text, payload);
  _setPending(true, context);
  eventBus.emit(EVENTS.DM_CONTEXT_READY, { context });

  try {
    const rawDecision = geminiDMService?.generateHybridDecision
      ? await geminiDMService.generateHybridDecision(context)
      : _buildFallbackDecision(context);

    const decision = _normaliseDecision(rawDecision);
    _applyLogic(decision.logic);
    _applyWorldDynamics(decision, context, "initial");
    _applyRewards(decision.rewards, "initial");
    _applyAffinityUpdate(decision.affinityUpdate);

    let finalDecision = decision;

    if (decision.skillCheck) {
      const skillResult = await _runSkillCheckGate(decision.skillCheck);

      const transitionContext = _buildContext(text, payload);

      const resolvedSkillSceneId = skillResult.targetSceneId
        ? await _resolveOrGenerateSceneId(
            skillResult.targetSceneId,
            transitionContext,
            "skill-check-outcome",
          )
        : "";

      if (resolvedSkillSceneId) {
        campaignManager.goToScene(resolvedSkillSceneId);
      }

      eventBus.emit(EVENTS.STORY_SKILL_CHECK_RESOLVED, {
        ability: skillResult.ability,
        dc: skillResult.dc,
        total: skillResult.total,
        success: skillResult.success,
        sceneId: resolvedSkillSceneId || skillResult.targetSceneId,
      });

      _emitCombatLogMessage(
        `[RENDSZER]: Képességpróba eredmény: ${skillResult.total}/${skillResult.dc} (${skillResult.success ? "SIKER" : "KUDARC"}).`,
      );

      const followUpRaw = geminiDMService?.repromptSkillCheckOutcome
        ? await geminiDMService.repromptSkillCheckOutcome({
            context: _buildContext(text, payload),
            skillCheck: decision.skillCheck,
            rollTotal: skillResult.total,
            success: skillResult.success,
            targetSceneId: resolvedSkillSceneId || skillResult.targetSceneId,
          })
        : {
            narration: skillResult.success
              ? "Épphogy sikerült a próba — a sors most melléd állt."
              : "A próba elbukott, és a sötétség előretör.",
            audioCue: "A kocka ítélete eldőlt.",
          };

      const followUpDecision = _normaliseDecision(followUpRaw);
      _applyLogic(followUpDecision.logic);
      _applyWorldDynamics(
        followUpDecision,
        _buildContext(text, payload),
        "skill-followup",
      );
      _applyRewards(followUpDecision.rewards, "skill-followup");
      _applyAffinityUpdate(followUpDecision.affinityUpdate);
      _emitDecisionNarration(followUpDecision);
      _emitDecisionAudio(followUpDecision);

      finalDecision = {
        ...decision,
        transition: "STORY",
        nextSceneId: resolvedSkillSceneId || skillResult.targetSceneId,
        skillCheckResult: skillResult,
        followUp: followUpDecision,
      };
    } else {
      _emitDecisionNarration(decision);
      _emitDecisionAudio(decision);
      const resolvedNextSceneId = await _applyTransition(
        decision,
        payload,
        _buildContext(text, payload),
      );
      finalDecision = {
        ...decision,
        nextSceneId: resolvedNextSceneId || decision.nextSceneId,
      };
    }

    eventBus.emit(EVENTS.DM_RESPONSE_RECEIVED, finalDecision);
    _incrementTurnCount();

    return finalDecision;
  } catch (error) {
    console.error("[HybridDecisionBridge] Döntésfeldolgozási hiba:", error);
    eventBus.emit(EVENTS.UI_NOTIFICATION, {
      text: "A Cyborg DM válasza megszakadt. Próbáld újra.",
      type: "error",
      ttl: 4200,
    });

    const fallbackDecision = _normaliseDecision(_buildFallbackDecision(context));
    if (fallbackDecision.narration) {
      _appendNarrative("dm", fallbackDecision.narration);
      eventBus.emit(EVENTS.NARRATION_RECEIVED, {
        text: fallbackDecision.narration,
        color: "gold",
      });
    }

    eventBus.emit(EVENTS.DM_RESPONSE_RECEIVED, fallbackDecision);
    _incrementTurnCount();
    return fallbackDecision;
  } finally {
    _setAwaitingRoll(false);
    _setPending(false);
  }
}

export function initHybridDecisionBridge() {
  if (_initialized) return;
  _initialized = true;

  eventBus.on(
    EVENTS.USER_INPUT_SUBMITTED,
    (payload) => processHybridTurn(payload),
    { priority: 120 },
  );
}

export async function submitHybridInput(text, payload = {}) {
  const input = String(text ?? "").trim();
  if (!input) return null;

  return eventBus.publish(EVENTS.USER_INPUT_SUBMITTED, {
    ...payload,
    text: input,
  });
}
