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

class CampaignManager {
  constructor() {
    this.campaign = null;
    this.worldState = {
      flags: {},
      variables: {},
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
    this.worldState = _clone(
      campaignData.initialState ?? { flags: {}, variables: {} },
    );
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

  getCurrentScene() {
    if (!this.campaign || !this.currentSceneId) return null;
    return this.campaign.scenes?.[this.currentSceneId] ?? null;
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

    const nextFlags = {
      ...this.worldState.flags,
      ...(stateUpdate.flags ?? {}),
    };
    const nextVariables = {
      ...this.worldState.variables,
      ...(stateUpdate.variables ?? {}),
    };

    const flagsChanged =
      JSON.stringify(nextFlags) !== JSON.stringify(this.worldState.flags);
    const variablesChanged =
      JSON.stringify(nextVariables) !==
      JSON.stringify(this.worldState.variables);

    if (!flagsChanged && !variablesChanged) return;

    this.worldState = {
      flags: nextFlags,
      variables: nextVariables,
    };

    this._syncStoreState();

    eventBus.emit(EVENTS.STATE_CHANGED, {
      newState: _clone(this.worldState),
    });
  }

  getWorldState() {
    return _clone(this.worldState);
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
}

export const campaignManager = new CampaignManager();
