import { eventBus, EVENTS } from "./eventBus.js";
import { gameStore } from "../store/index.js";
import { performSkillCheck } from "./actionDispatcher.js";

const ABILITY_TO_DEFAULT_SKILL = {
  strength: "athletics",
  dexterity: "stealth",
  constitution: "athletics",
  intelligence: "arcana",
  wisdom: "perception",
  charisma: "persuasion",
};

function _clone(value) {
  return structuredClone(value);
}

const DEFAULT_WORLD_TIME = Object.freeze({
  day: 1,
  hour: 8,
  minute: 0,
});

const DEFAULT_WORLD_FACTIONS = Object.freeze({
  City_Guard: 0,
  Underworld: 0,
  Merchants: 0,
});

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class CampaignManager {
  constructor() {
    this.campaign = null;
    this.worldState = {
      flags: {},
      variables: {},
      npcAffinity: {},
      time: { ...DEFAULT_WORLD_TIME },
      factions: { ...DEFAULT_WORLD_FACTIONS },
    };
    this.currentSceneId = null;
    this.activeCombatScene = null;

    this.subscribeToEvents();
  }

  subscribeToEvents() {
    eventBus.on(EVENTS.COMBAT_ENDED, (payload) => {
      this.handleCombatEnded(payload);
    });
  }

  loadCampaign(campaignData) {
    if (!campaignData || typeof campaignData !== "object") {
      throw new Error("Érvénytelen kampány adat.");
    }

    this.campaign = campaignData;
    const initialState = _clone(campaignData.initialState ?? {});
    this.worldState = {
      flags: { ...(initialState.flags ?? {}) },
      variables: { ...(initialState.variables ?? {}) },
      npcAffinity: { ...(initialState.npcAffinity ?? {}) },
      time: this._normaliseTime(initialState.time),
      factions: this._normaliseFactions(initialState.factions),
    };
    this.currentSceneId = null;
    this.activeCombatScene = null;

    this._syncStoreState();
    eventBus.emit(EVENTS.CAMPAIGN_LOADED, {
      campaignName: this.campaign.campaignName ?? "Unnamed Campaign",
      worldState: _clone(this.worldState),
    });
    eventBus.emit(EVENTS.STATE_CHANGED, {
      newState: _clone(this.worldState),
    });
  }

  isLoaded() {
    return !!this.campaign;
  }

  hasScene(sceneId) {
    const id = String(sceneId ?? "").trim();
    if (!id) return false;
    return !!this.campaign?.scenes?.[id];
  }

  injectTemporaryScene(sceneId, sceneData = {}) {
    const id = String(sceneId ?? "").trim();
    if (!id || !this.campaign) return false;

    if (!this.campaign.scenes || typeof this.campaign.scenes !== "object") {
      this.campaign.scenes = {};
    }

    const normalisedScene = {
      type: String(sceneData.type ?? "narrative").trim() || "narrative",
      vibe: String(sceneData.vibe ?? "generated").trim() || "generated",
      text: String(sceneData.text ?? "A történet új irányba fordul.").trim(),
      context: String(sceneData.context ?? "").trim(),
      character: String(sceneData.character ?? "").trim(),
      onLeave: String(sceneData.onLeave ?? "").trim() || null,
      encounterId: String(sceneData.encounterId ?? "").trim() || null,
      onWin: String(sceneData.onWin ?? "").trim() || null,
      onLoss: String(sceneData.onLoss ?? "").trim() || null,
      skill: String(sceneData.skill ?? "").trim() || null,
      difficulty: Number(sceneData.difficulty ?? sceneData.dc ?? 0) || null,
      dc: Number(sceneData.dc ?? sceneData.difficulty ?? 0) || null,
      onSuccess: String(sceneData.onSuccess ?? "").trim() || null,
      onFailure: String(sceneData.onFailure ?? "").trim() || null,
      setFlag:
        sceneData.setFlag && typeof sceneData.setFlag === "object"
          ? { ...sceneData.setFlag }
          : null,
      setVariable:
        sceneData.setVariable && typeof sceneData.setVariable === "object"
          ? { ...sceneData.setVariable }
          : null,
      choices: Array.isArray(sceneData.choices)
        ? sceneData.choices
            .map((choice) => {
              if (!choice || typeof choice !== "object") return null;
              const text = String(choice.text ?? "").trim();
              if (!text) return null;
              return {
                text,
                nextScene: String(choice.nextScene ?? "").trim() || null,
                setFlag:
                  choice.setFlag && typeof choice.setFlag === "object"
                    ? { ...choice.setFlag }
                    : undefined,
                setVariable:
                  choice.setVariable && typeof choice.setVariable === "object"
                    ? { ...choice.setVariable }
                    : undefined,
              };
            })
            .filter(Boolean)
        : [],
      _generated: true,
      _generatedAt: Date.now(),
    };

    this.campaign.scenes[id] = normalisedScene;
    return true;
  }

  getCurrentScene() {
    if (!this.campaign || !this.currentSceneId) return null;
    return this.campaign.scenes?.[this.currentSceneId] ?? null;
  }

  getCurrentSceneContext() {
    const scene = this.getCurrentScene();
    if (!scene) return null;

    return {
      sceneId: this.currentSceneId,
      type: scene.type,
      vibe: scene.vibe ?? "default",
      character: scene.character ?? null,
      context: scene.context ?? scene.text ?? "",
      onLeave: scene.onLeave ?? null,
    };
  }

  goToScene(sceneId) {
    if (!this.campaign || !this.campaign.scenes?.[sceneId]) {
      console.error(`[CampaignManager] Scene with id "${sceneId}" not found.`);
      return;
    }

    this.currentSceneId = sceneId;
    const scene = this.campaign.scenes[sceneId];

    if (scene.setFlag && typeof scene.setFlag === "object") {
      this.updateState({ flags: scene.setFlag });
    }

    if (scene.setVariable && typeof scene.setVariable === "object") {
      this.updateState({ variables: scene.setVariable });
    }

    eventBus.emit(EVENTS.SCENE_LOADED, {
      scene,
      sceneId,
      worldState: _clone(this.worldState),
    });

    if (scene.type === "combat") {
      this.activeCombatScene = {
        sceneId,
        sceneData: scene,
      };

      if (!scene.encounterId) {
        this.handleCombatEnded({
          result: "error",
          reason: `A(z) "${sceneId}" harci jelenetből hiányzik az encounterId.`,
        });
        return;
      }

      eventBus.emit(EVENTS.COMBAT_TRIGGERED, {
        sceneData: scene,
        sceneId,
        encounterId: scene.encounterId,
        onWinScene: scene.onWin ?? null,
        onLossScene: scene.onLoss ?? null,
      });
      return;
    }

    if (scene.type === "skill_check") {
      void this._resolveSkillCheck(scene, sceneId);
    }
  }

  makeChoice(choiceObject) {
    if (!choiceObject || typeof choiceObject !== "object") return;

    if (choiceObject.setFlag && typeof choiceObject.setFlag === "object") {
      this.updateState({ flags: choiceObject.setFlag });
    }

    if (
      choiceObject.setVariable &&
      typeof choiceObject.setVariable === "object"
    ) {
      this.updateState({ variables: choiceObject.setVariable });
    }

    if (choiceObject.nextScene) {
      this.goToScene(choiceObject.nextScene);
    }
  }

  updateState(stateUpdate) {
    if (!stateUpdate || typeof stateUpdate !== "object") return;

    const incomingFlags = stateUpdate.flags ?? {};
    const incomingVariables = stateUpdate.variables ?? {};
    const incomingAffinity = stateUpdate.npcAffinity ?? {};
    const hasIncomingTime =
      stateUpdate.time && typeof stateUpdate.time === "object";
    const incomingFactions =
      stateUpdate.factions && typeof stateUpdate.factions === "object"
        ? stateUpdate.factions
        : {};

    const changedFlags = Object.entries(incomingFlags).filter(
      ([key, value]) => this.worldState.flags[key] !== value,
    );

    const changedVariables = Object.entries(incomingVariables).filter(
      ([key, value]) => this.worldState.variables[key] !== value,
    );

    const changedAffinity = Object.entries(incomingAffinity).filter(
      ([key, value]) => this.worldState.npcAffinity?.[key] !== value,
    );

    const nextTime = hasIncomingTime
      ? this._normaliseTime({ ...(this.worldState.time ?? {}), ...stateUpdate.time })
      : this._normaliseTime(this.worldState.time);

    const prevTime = this._normaliseTime(this.worldState.time);
    const timeChanged =
      hasIncomingTime &&
      (prevTime.day !== nextTime.day ||
        prevTime.hour !== nextTime.hour ||
        prevTime.minute !== nextTime.minute);

    const changedFactions = Object.entries(incomingFactions)
      .map(([faction, value]) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        const nextValue = _clamp(Math.round(numeric), -100, 100);
        const previousValue = Number(this.worldState.factions?.[faction] ?? 0);
        if (nextValue === previousValue) return null;

        return [faction, nextValue];
      })
      .filter(Boolean);

    if (
      changedFlags.length === 0 &&
      changedVariables.length === 0 &&
      changedAffinity.length === 0 &&
      changedFactions.length === 0 &&
      !timeChanged
    )
      return;

    const nextFlags = {
      ...this.worldState.flags,
      ...incomingFlags,
    };
    const nextVariables = {
      ...this.worldState.variables,
      ...incomingVariables,
    };
    const nextAffinity = {
      ...(this.worldState.npcAffinity ?? {}),
      ...incomingAffinity,
    };
    const nextFactions = {
      ...(this.worldState.factions ?? {}),
      ...Object.fromEntries(changedFactions),
    };

    this.worldState = {
      flags: nextFlags,
      variables: nextVariables,
      npcAffinity: nextAffinity,
      time: nextTime,
      factions: nextFactions,
    };

    changedFlags.forEach(([flag, value]) => {
      eventBus.emit(EVENTS.FLAG_CHANGED, {
        flag,
        value,
        worldState: _clone(this.worldState),
      });
    });

    this._syncStoreState();

    eventBus.emit(EVENTS.STATE_CHANGED, {
      newState: _clone(this.worldState),
    });
  }

  getWorldState() {
    return _clone(this.worldState);
  }

  getTimeOfDay(timeInput = this.worldState.time) {
    const time = this._normaliseTime(timeInput);
    if (time.hour >= 5 && time.hour < 8) return "Dawn";
    if (time.hour >= 8 && time.hour < 18) return "Day";
    if (time.hour >= 18 && time.hour < 21) return "Dusk";
    return "Night";
  }

  describeCurrentTime(timeInput = this.worldState.time) {
    const time = this._normaliseTime(timeInput);
    const timeOfDay = this.getTimeOfDay(time);
    const labelMap = {
      Dawn: "Hajnal",
      Day: "Nappal",
      Dusk: "Alkonyat",
      Night: "Éjszaka",
    };

    const hour = String(time.hour).padStart(2, "0");
    const minute = String(time.minute).padStart(2, "0");
    return `Nap ${time.day}, ${hour}:${minute} (${labelMap[timeOfDay] ?? timeOfDay})`;
  }

  advanceTime(minutes, meta = {}) {
    const deltaRaw = Number(minutes);
    const deltaMinutes =
      Number.isFinite(deltaRaw) && deltaRaw > 0 ? Math.floor(deltaRaw) : 0;

    if (!deltaMinutes) {
      return {
        time: this._normaliseTime(this.worldState.time),
        timeOfDay: this.getTimeOfDay(this.worldState.time),
        deltaMinutes: 0,
      };
    }

    const previousTime = this._normaliseTime(this.worldState.time);
    const previousTimeOfDay = this.getTimeOfDay(previousTime);

    const previousTotalMinutes =
      (previousTime.day - 1) * 24 * 60 +
      previousTime.hour * 60 +
      previousTime.minute;
    const nextTotalMinutes = Math.max(0, previousTotalMinutes + deltaMinutes);

    const day = Math.floor(nextTotalMinutes / (24 * 60)) + 1;
    const minuteOfDay = nextTotalMinutes % (24 * 60);
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;

    const nextTime = this._normaliseTime({ day, hour, minute });
    const nextTimeOfDay = this.getTimeOfDay(nextTime);

    this.updateState({ time: nextTime });

    eventBus.emit(EVENTS.TIME_ADVANCED, {
      previousTime,
      time: nextTime,
      deltaMinutes,
      previousTimeOfDay,
      nextTimeOfDay,
      source: meta.source ?? "campaign-manager",
      reason: meta.reason ?? "",
    });

    if (nextTimeOfDay !== previousTimeOfDay) {
      eventBus.emit(EVENTS.TIME_OF_DAY_CHANGED, {
        previousTimeOfDay,
        nextTimeOfDay,
        previousTime,
        time: nextTime,
        source: meta.source ?? "campaign-manager",
        reason: meta.reason ?? "",
      });
    }

    return {
      previousTime,
      time: nextTime,
      deltaMinutes,
      previousTimeOfDay,
      timeOfDay: nextTimeOfDay,
    };
  }

  updateFactionReputation(faction, delta, meta = {}) {
    const factionKey = String(faction ?? "").trim();
    const deltaRaw = Number(delta);
    const factionDelta =
      Number.isFinite(deltaRaw) && deltaRaw !== 0 ? Math.round(deltaRaw) : 0;

    if (!factionKey || !factionDelta) return null;

    const previousValue = Number(this.worldState.factions?.[factionKey] ?? 0);
    const nextValue = _clamp(previousValue + factionDelta, -100, 100);
    const appliedDelta = nextValue - previousValue;
    if (appliedDelta === 0) return null;

    this.updateState({
      factions: {
        [factionKey]: nextValue,
      },
    });

    const payload = {
      faction: factionKey,
      previousValue,
      newValue: nextValue,
      delta: appliedDelta,
      source: meta.source ?? "campaign-manager",
      reason: meta.reason ?? "",
    };

    eventBus.emit(EVENTS.FACTION_REPUTATION_CHANGED, payload);

    return payload;
  }

  applyFactionUpdates(updates = [], meta = {}) {
    if (!Array.isArray(updates) || updates.length === 0) return [];

    const results = [];
    updates.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;

      const faction = String(entry.faction ?? "").trim();
      const delta = Number(entry.delta ?? 0);
      const result = this.updateFactionReputation(faction, delta, meta);
      if (result) results.push(result);
    });

    return results;
  }

  handleCombatEnded(payload = {}) {
    const activeCombat = this.activeCombatScene;
    if (!activeCombat) {
      const activeScene = this.getCurrentScene();
      if (activeScene?.type === "combat") {
        console.warn(
          "[CampaignManager] COMBAT_ENDED esemény érkezett, de az aktív harc kontextusa hiányzik.",
        );
      }
      return;
    }

    this.activeCombatScene = null;

    const result = this._normaliseCombatResult(payload);
    const { sceneData, sceneId } = activeCombat;

    switch (result) {
      case "win": {
        if (sceneData.onWin) {
          this.goToScene(sceneData.onWin);
          return;
        }

        console.error(
          `[CampaignManager] Győzelem után nincs onWin megadva a(z) "${sceneId}" jelenethez.`,
        );
        this.goToScene("start");
        return;
      }

      case "loss": {
        if (sceneData.onLoss) {
          this.goToScene(sceneData.onLoss);
          return;
        }

        console.error(
          `[CampaignManager] Vereség után nincs onLoss megadva a(z) "${sceneId}" jelenethez. Fallback: start.`,
        );
        this.goToScene("start");
        return;
      }

      case "error": {
        const reason =
          typeof payload.reason === "string" && payload.reason.trim().length > 0
            ? payload.reason
            : "Ismeretlen harci hiba";

        console.error(`[CampaignManager] Harc hiba: ${reason}`);

        eventBus.emit(EVENTS.UI_NOTIFICATION, {
          text: `⚠️ Harci hiba: ${reason}`,
          type: "error",
          ttl: 4500,
        });

        if (sceneData.onLoss) {
          this.goToScene(sceneData.onLoss);
          return;
        }

        this.goToScene("start");
        return;
      }

      default:
        console.warn(
          `[CampaignManager] Ismeretlen harci eredmény: "${result}". Fallback: start.`,
        );
        this.goToScene("start");
    }
  }

  async _resolveSkillCheck(scene, sceneId) {
    const skillKey = this._normaliseSkill(scene.skill);
    const dc = Number(scene.difficulty ?? scene.dc ?? 10);

    eventBus.emit(EVENTS.STORY_SKILL_CHECK_START, {
      skill: skillKey,
      dc,
      sceneId,
    });

    let success = false;
    let rolled = "?";

    try {
      const result = await performSkillCheck(skillKey, dc);
      success = result?.success === true;
      rolled = result?.result?.total ?? "?";
    } catch (error) {
      console.error("[CampaignManager] Skill check failed:", error);
    }

    eventBus.emit(EVENTS.STORY_SKILL_CHECK_END, {
      success,
      rolled,
      sceneId,
    });

    const nextScene = success ? scene.onSuccess : scene.onFailure;
    if (nextScene) {
      this.goToScene(nextScene);
    }
  }

  _normaliseSkill(skill) {
    const key = String(skill ?? "").trim();
    if (!key) return "stealth";

    if (ABILITY_TO_DEFAULT_SKILL[key]) {
      return ABILITY_TO_DEFAULT_SKILL[key];
    }

    return key;
  }

  _normaliseCombatResult(payload) {
    const raw = String(payload.result ?? payload.outcome ?? "")
      .trim()
      .toLowerCase();

    if (raw === "win" || raw === "victory") return "win";
    if (raw === "loss" || raw === "defeat") return "loss";
    if (raw === "error") return "error";

    return raw || "error";
  }

  _syncStoreState() {
    const state = gameStore.getState();
    const nextWorld = {
      ...state.world,
      storyFlags: {
        ...(state.world.storyFlags ?? {}),
        ...(this.worldState.flags ?? {}),
      },
      npcAffinity: {
        ...(state.world.npcAffinity ?? {}),
        ...(this.worldState.npcAffinity ?? {}),
      },
      time: this._normaliseTime(this.worldState.time),
      factions: {
        ...(state.world.factions ?? {}),
        ...(this.worldState.factions ?? {}),
      },
    };

    const hasPlayerGold = Object.prototype.hasOwnProperty.call(
      this.worldState.variables ?? {},
      "player_gold",
    );

    const nextPlayer = hasPlayerGold
      ? {
          ...state.player,
          gold: Number(this.worldState.variables.player_gold),
        }
      : state.player;

    gameStore.setState(
      {
        world: nextWorld,
        player: nextPlayer,
      },
      "campaignManager:syncState",
    );
  }

  _normaliseTime(timeInput = {}) {
    const source = timeInput && typeof timeInput === "object" ? timeInput : {};
    const dayRaw = Number(source.day);
    const hourRaw = Number(source.hour);
    const minuteRaw = Number(source.minute);

    return {
      day:
        Number.isFinite(dayRaw) && dayRaw >= 1
          ? Math.floor(dayRaw)
          : DEFAULT_WORLD_TIME.day,
      hour: _clamp(
        Number.isFinite(hourRaw) ? Math.floor(hourRaw) : DEFAULT_WORLD_TIME.hour,
        0,
        23,
      ),
      minute: _clamp(
        Number.isFinite(minuteRaw)
          ? Math.floor(minuteRaw)
          : DEFAULT_WORLD_TIME.minute,
        0,
        59,
      ),
    };
  }

  _normaliseFactions(factionsInput = {}) {
    const source =
      factionsInput && typeof factionsInput === "object" ? factionsInput : {};
    const next = {
      ...DEFAULT_WORLD_FACTIONS,
    };

    Object.entries(source).forEach(([faction, value]) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      next[faction] = _clamp(Math.round(numeric), -100, 100);
    });

    return next;
  }
}

export const campaignManager = new CampaignManager();
