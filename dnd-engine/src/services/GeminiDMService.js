import { GoogleGenerativeAI } from "@google/generative-ai";

import { eventBus, EVENTS } from "../engine/eventBus.js";
import { campaignManager } from "../engine/CampaignManager.js";
import { gameStore } from "../store/index.js";

const DEFAULT_NARRATION_INTERVAL = 3;

const DEFAULT_GEMINI_MODEL =
  String(import.meta.env.VITE_GEMINI_MODEL ?? "gemini-2.5-flash").trim() ||
  "gemini-2.5-flash";

const FALLBACK_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

const COMBAT_NARRATION_SYSTEM_INSTRUCTION = `Te egy sötét fantasy Dungeon Master vagy. Rövid, velős, 10-15 szavas magyar nyelvű leírásokat generálj a harci eseményekről. A válaszod MINDIG egy valid JSON objektum legyen, ami tartalmaz egy 'text' mezőt a narrációnak és egy 'audioOutput' mezőt, ami a base64 kódolt hangfájlt tartalmazza. A hang stílusa legyen mély, rekedtes és gótikus.`;

const CYBORG_DM_SYSTEM_INSTRUCTION = [
  "Te egy hibrid RPG motor agya vagy. SOHA ne válaszolj sima szöveggel. MINDIG egy valid JSON-t adj vissza.",
  "Kimenet sémája:",
  '{"narration":"", "audioCue":"", "logic":{"flags":[], "variables":[]}, "timeDelta":5, "factionUpdates":[{"faction":"", "delta":0}], "audioProfile":{"ambient":"", "musicMood":""}, "transition":"STORY", "nextSceneId":"", "encounterId":"", "skillCheck":{"ability":"", "dc":10, "successScene":"", "failScene":""}, "rewards":{"xp":0, "gold":0, "items":[]}, "affinityUpdate":{"npcId":"", "delta":0}}',
  "Az akciók időbe telnek. MINDIG adj vissza timeDelta értéket (percben).",
  "A skillCheck, rewards, affinityUpdate, factionUpdates és audioProfile mezők opcionálisak.",
  "Ha bizonytalan vagy a kimenetben, ne dönts transition-ről; küldj skillCheck objektumot.",
].join("\n");

const HYBRID_JSON_SCHEMA =
  '{"narration":"", "audioCue":"", "logic":{"flags":[], "variables":[]}, "timeDelta":5, "factionUpdates":[{"faction":"", "delta":0}], "audioProfile":{"ambient":"", "musicMood":""}, "transition":"STORY", "nextSceneId":"", "encounterId":"", "skillCheck":{"ability":"", "dc":10, "successScene":"", "failScene":""}, "rewards":{"xp":0, "gold":0, "items":[]}, "affinityUpdate":{"npcId":"", "delta":0}}';

function _resolveNarrationInterval() {
  const rawValue = Number.parseInt(
    String(import.meta.env.VITE_GEMINI_NARRATION_EVERY ?? ""),
    10,
  );

  if (!Number.isFinite(rawValue) || rawValue < 1) {
    return DEFAULT_NARRATION_INTERVAL;
  }

  return rawValue;
}

function _resolveModelCandidates(primaryModel) {
  const envFallbacks = String(import.meta.env.VITE_GEMINI_MODEL_FALLBACKS ?? "")
    .split(",")
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);

  const merged = [primaryModel, ...envFallbacks, ...FALLBACK_GEMINI_MODELS]
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);

  return [...new Set(merged)];
}

class GeminiDMService {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error("Gemini API kulcs hiányzik!");
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelCandidates = _resolveModelCandidates(DEFAULT_GEMINI_MODEL);
    this.activeModelIndex = 0;
    this.activeModelName =
      this.modelCandidates[this.activeModelIndex] ?? DEFAULT_GEMINI_MODEL;

    this._applyModelConfiguration(this.activeModelName);

    this.audioContext = null;
    this.attackCounter = 0;
    this.narrationInterval = _resolveNarrationInterval();
    this.currentVibe = "default";
    this._initialized = false;
    this._boundDamageHandler = this.handleDamageEvent.bind(this);
  }

  _applyModelConfiguration(modelName) {
    const resolvedModel =
      String(modelName ?? "").trim() || DEFAULT_GEMINI_MODEL;
    this.activeModelName = resolvedModel;

    this.model = this.genAI.getGenerativeModel({
      model: resolvedModel,
      systemInstruction: COMBAT_NARRATION_SYSTEM_INSTRUCTION,
    });
    this.cyborgModel = this.genAI.getGenerativeModel({
      model: resolvedModel,
      systemInstruction: CYBORG_DM_SYSTEM_INSTRUCTION,
    });
    this.utilityModel = this.genAI.getGenerativeModel({
      model: resolvedModel,
    });
  }

  _isModelUnavailableError(error) {
    const message = String(error?.message ?? "").toLowerCase();

    return (
      message.includes("404") ||
      message.includes("not found") ||
      message.includes("no longer available") ||
      message.includes("not supported for generatecontent")
    );
  }

  async _generateContentWithFallback(modelKind, prompt) {
    const kind =
      modelKind === "utility"
        ? "utility"
        : modelKind === "cyborg"
          ? "cyborg"
          : "combat";

    let lastError;
    for (
      let candidateIndex = this.activeModelIndex;
      candidateIndex < this.modelCandidates.length;
      candidateIndex += 1
    ) {
      if (candidateIndex !== this.activeModelIndex) {
        this.activeModelIndex = candidateIndex;
        this._applyModelConfiguration(this.modelCandidates[candidateIndex]);
      }

      const model =
        kind === "utility"
          ? this.utilityModel
          : kind === "cyborg"
            ? this.cyborgModel
            : this.model;

      try {
        return await model.generateContent(prompt);
      } catch (error) {
        lastError = error;
        if (!this._isModelUnavailableError(error)) {
          throw error;
        }

        const hasNext = candidateIndex < this.modelCandidates.length - 1;
        if (hasNext) {
          const nextModelName = this.modelCandidates[candidateIndex + 1];
          console.warn(
            `[GeminiDMService] Model váltás: ${this.activeModelName} nem elérhető, fallback: ${nextModelName}`,
          );
        }
      }
    }

    throw lastError ?? new Error("Nincs elérhető Gemini modell.");
  }

  initialize() {
    if (this._initialized) return;

    eventBus.subscribe(EVENTS.DAMAGE_APPLIED, this._boundDamageHandler, -50);
    this._initialized = true;
  }

  handleDamageEvent(payload) {
    const combatData = this._buildCombatData(payload);
    if (!combatData) return;

    this.attackCounter += 1;

    if (
      this.attackCounter % this.narrationInterval !== 0 &&
      !combatData.isCritical &&
      !combatData.isFatal
    ) {
      return;
    }

    this.attackCounter = 0;
    void this.generateNarration(combatData).catch((error) => {
      console.error(
        "[GeminiDMService] Hiba a narrációs háttérfeladat futtatása közben:",
        error,
      );
    });
  }

  _buildCombatData(payload) {
    if (!payload || typeof payload !== "object") return null;

    const state = gameStore.getState();
    if (!state.combat?.active) return null;

    const damage = Math.max(0, Math.floor(payload.amount ?? 0));
    const meta = payload.meta ?? {};

    const defender = state.combat.turnOrder.find(
      (participant) => participant.id === payload.targetId,
    );

    const attacker = state.combat.turnOrder.find(
      (participant) => participant.id === state.combat.currentTurnActorId,
    );

    const defenderHpBefore = Number.isFinite(meta.defenderHpBefore)
      ? Number(meta.defenderHpBefore)
      : Number(defender?.hp);

    const isFatal =
      meta.isFatal === true ||
      (Number.isFinite(defenderHpBefore) &&
        defenderHpBefore > 0 &&
        damage >= defenderHpBefore);

    return {
      attacker: {
        name: meta.attackerName ?? attacker?.name ?? "Ismeretlen támadó",
      },
      defender: {
        name:
          meta.defenderName ??
          defender?.name ??
          payload.targetId ??
          "Ismeretlen célpont",
      },
      damage,
      weaponName: meta.weaponName ?? payload.damageType ?? "fegyver",
      isCritical: payload.isCritical === true,
      isFatal,
    };
  }

  async generateNarration(combatData) {
    try {
      const worldStateContext = this._buildWorldStateContext();
      const prompt = `Generálj egy narrációt a következő eseményről:\n- Támadó: ${combatData.attacker.name}\n- Célpont: ${combatData.defender.name}\n- Sebzés: ${combatData.damage}\n- Fegyver: ${combatData.weaponName}\n- Kritikus találat: ${combatData.isCritical ? "Igen" : "Nem"}\n- Halálos csapás: ${combatData.isFatal ? "Igen" : "Nem"}\n\n${worldStateContext}`;

      const result = await this._generateContentWithFallback("combat", prompt);
      const responseText = result.response.text();
      const narration = this._parseNarrationResponse(responseText);

      if (narration?.text) {
        this.displayText(narration.text);
      }

      if (narration?.audioOutput) {
        await this.playAudio(narration.audioOutput);
      }
    } catch (error) {
      console.error(
        "[GeminiDMService] Hiba a narráció generálása közben:",
        error,
      );
    }
  }

  async generateNarrative(basePrompt) {
    try {
      const worldStateContext = this._buildWorldStateContext();
      const prompt = `${worldStateContext}\n\nFeladat: ${basePrompt}`;

      const result = await this._generateContentWithFallback("combat", prompt);
      const responseText = result.response.text();
      const narration = this._parseNarrationResponse(responseText);

      return narration?.text || String(responseText ?? "").trim();
    } catch (error) {
      console.error(
        "[GeminiDMService] Hiba a szöveges narráció generálásakor:",
        error,
      );
      return "";
    }
  }

  setCurrentVibe(vibeName) {
    const nextVibe = String(vibeName ?? "default").trim();
    this.currentVibe = nextVibe || "default";
  }

  async reasonPlayerIntent(playerInput, sceneContext = {}) {
    const fallback = {
      action: "STAY",
      payload: null,
      narrative: "Az őr összehúzott szemmel vizsgál, de egyelőre nem mozdul.",
    };

    try {
      const worldStateContext = this._buildWorldStateContext();
      const sceneDescription = String(
        sceneContext.context ?? sceneContext.text ?? "",
      ).trim();
      const character = String(sceneContext.character ?? "őr").trim() || "őr";
      const onLeave = String(sceneContext.onLeave ?? "").trim();

      const prompt = [
        "A feladatod: röviden értelmezd a játékos kihallgatási szándékát.",
        "Kimenet kizárólag valid JSON legyen.",
        "Engedélyezett action értékek: SET_FLAG, COMBAT_TRIGGERED, STAY, LEAVE.",
        'SET_FLAG esetén payload legyen objektum (pl. {"guard_bribed": true}).',
        'COMBAT_TRIGGERED esetén payload legyen {"sceneId": string} vagy {"encounterId": string}.',
        "LEAVE esetén payload lehet null. Ha van kilépési jelenet, használd ezt: " +
          (onLeave || "nincs megadva"),
        "A narrative mező legyen 1 mondatos magyar, sötét hangulatú reagálás.",
        `Kihallgatott karakter: ${character}`,
        `Jelenet kontextus: ${sceneDescription || "nincs"}`,
        `Aktív vibe: ${this.currentVibe}`,
        worldStateContext,
        `Játékos input: ${playerInput}`,
        "Várt forma:",
        '{"action":"STAY","payload":null,"narrative":"..."}',
      ].join("\n");

      const result = await this._generateContentWithFallback("utility", prompt);
      const raw = result.response.text();
      const parsed = this._parseJsonObject(raw);

      if (!parsed) return fallback;

      const allowedActions = new Set([
        "SET_FLAG",
        "COMBAT_TRIGGERED",
        "STAY",
        "LEAVE",
      ]);

      const action = String(parsed.action ?? "STAY")
        .trim()
        .toUpperCase();
      const safeAction = allowedActions.has(action) ? action : "STAY";
      const payload =
        parsed.payload && typeof parsed.payload === "object"
          ? parsed.payload
          : null;

      const narrative =
        typeof parsed.narrative === "string" && parsed.narrative.trim().length
          ? parsed.narrative.trim()
          : fallback.narrative;

      return {
        action: safeAction,
        payload,
        narrative,
      };
    } catch (error) {
      console.error("[GeminiDMService] reasonPlayerIntent hiba:", error);
      return fallback;
    }
  }

  async generateHybridDecision(context = {}) {
    const fallback = {
      narration:
        "A világ egy pillanatra elnémul, majd lassan reagál a döntésedre.",
      audioCue: "A DM hangja komoran visszhangzik a sötétben.",
      logic: {
        flags: [],
        variables: [],
      },
      transition: "STORY",
      nextSceneId: "",
      encounterId: "",
      skillCheck: null,
      rewards: null,
      affinityUpdate: null,
      timeDelta: 5,
      factionUpdates: [],
      audioProfile: null,
      audioOutput: null,
    };

    try {
      const prompt = this._buildHybridDecisionPrompt(context);
      const result = await this._generateContentWithFallback("cyborg", prompt);
      const raw = result.response.text();
      const parsed = this._parseJsonObject(raw);

      if (!parsed) {
        return {
          ...fallback,
          narration:
            String(raw ?? "").trim() ||
            "A DM válasza homályos marad, de a történet tovább hömpölyög.",
        };
      }

      const logic =
        parsed.logic && typeof parsed.logic === "object" ? parsed.logic : {};
      const transition = String(parsed.transition ?? "STORY")
        .trim()
        .toUpperCase();

      return {
        narration:
          typeof parsed.narration === "string" && parsed.narration.trim()
            ? parsed.narration.trim()
            : fallback.narration,
        audioCue:
          typeof parsed.audioCue === "string" ? parsed.audioCue.trim() : "",
        logic: {
          flags:
            Array.isArray(logic.flags) ||
            (logic.flags && typeof logic.flags === "object")
              ? logic.flags
              : [],
          variables:
            Array.isArray(logic.variables) ||
            (logic.variables && typeof logic.variables === "object")
              ? logic.variables
              : [],
        },
        transition: transition === "COMBAT" ? "COMBAT" : "STORY",
        nextSceneId:
          typeof parsed.nextSceneId === "string"
            ? parsed.nextSceneId.trim()
            : "",
        encounterId:
          typeof parsed.encounterId === "string"
            ? parsed.encounterId.trim()
            : "",
        skillCheck: this._normaliseHybridSkillCheck(parsed.skillCheck),
        rewards: this._normaliseHybridRewards(parsed.rewards),
        affinityUpdate: this._normaliseHybridAffinityUpdate(
          parsed.affinityUpdate,
        ),
        timeDelta: this._normaliseHybridTimeDelta(parsed.timeDelta),
        factionUpdates: this._normaliseHybridFactionUpdates(
          parsed.factionUpdates,
        ),
        audioProfile: this._normaliseHybridAudioProfile(parsed.audioProfile),
        audioOutput:
          typeof parsed.audioOutput === "string" ? parsed.audioOutput : null,
      };
    } catch (error) {
      console.error("[GeminiDMService] generateHybridDecision hiba:", error);
      return fallback;
    }
  }

  _buildHybridDecisionPrompt(context = {}) {
    const worldFlags = context.worldState?.flags ?? {};
    const worldVariables = context.worldState?.variables ?? {};
    const worldTime = context.worldState?.time ?? {
      day: 1,
      hour: 8,
      minute: 0,
    };
    const worldFactions = context.worldState?.factions ?? {};
    const currentScene = context.currentScene ?? {};
    const sceneChoices = Array.isArray(currentScene.choices)
      ? currentScene.choices.filter(Boolean).join(" | ")
      : "";
    const worldTimeLabel = String(context.worldTimeLabel ?? "").trim();

    return [
      "Feladat: értelmezd a játékos szándékát egy hibrid RPG motor számára.",
      "Kimenet KIZÁRÓLAG valid JSON lehet, markdown és magyarázat nélkül.",
      `Kötelező séma: ${HYBRID_JSON_SCHEMA}`,
      "MINDIG adj vissza timeDelta mezőt (egész szám percben).",
      'A logic.flags tömb elemei ilyen objektumok legyenek: {"key": string, "value": boolean}.',
      'A logic.variables tömb elemei ilyen objektumok legyenek: {"key": string, "value": string|number|boolean}.',
      'Az affinityUpdate mező formája: {"npcId": string, "delta": number}.',
      'A factionUpdates elemei: {"faction": string, "delta": number}.',
      'Az audioProfile mező: {"ambient": string, "musicMood": string}.',
      "A skillCheck mező opcionális, de ha bizonytalan a kimenet, ezt KÖTELEZŐ használni transition döntés helyett.",
      "A rewards mező opcionális jutalmakat adhat: xp, gold, items.",
      "Pillangó-effekt: a worldState flags alapján alakítsd a történet kimenetét.",
      "A skill check DC értékét igazítsd az NPC affinity-hez (rossz viszony -> magasabb DC, jó viszony -> alacsonyabb DC).",
      "Példa: Guard_Captain affinity -50 esetén persuasion DC ~20, affinity +50 esetén DC ~10.",
      "A napszak és fényviszony befolyásolja a narrációt és a nehézséget.",
      'Ha a játékos tettei harcot indokolnak, transition legyen "COMBAT" és encounterId legyen kitöltve.',
      'Ha bizonytalan az akció kimenete, transition maradjon "STORY", és töltsd ki a skillCheck objektumot (ability, dc, successScene, failScene).',
      'Ha nincs jelenetváltás, nextSceneId legyen üres string (\"\").',
      `Játékos input: ${String(context.playerInput ?? "")}`,
      `Forrás: ${String(context.source ?? "unknown")}`,
      `Jelenlegi idő: ${worldTimeLabel || `Nap ${worldTime.day ?? 1}, ${String(worldTime.hour ?? 8).padStart(2, "0")}:${String(worldTime.minute ?? 0).padStart(2, "0")} (${String(context.worldState?.timeOfDay ?? "Day")})`}`,
      `Jelenlegi napszak: ${String(context.worldState?.timeOfDay ?? "Day")}`,
      `Aktív jelenet: ${JSON.stringify({
        sceneId: currentScene.sceneId ?? "",
        type: currentScene.type ?? "narrative",
        text: currentScene.text ?? "",
        encounterId: currentScene.encounterId ?? "",
        onLeave: currentScene.onLeave ?? "",
      })}`,
      `Jelenet választások: ${sceneChoices || "nincs"}`,
      `WorldState flags: ${JSON.stringify(worldFlags)}`,
      `WorldState variables: ${JSON.stringify(worldVariables)}`,
      `WorldState time: ${JSON.stringify(worldTime)}`,
      `WorldState factions: ${JSON.stringify(worldFactions)}`,
      `WorldState npcAffinity: ${JSON.stringify(context.worldState?.npcAffinity ?? {})}`,
    ].join("\n");
  }

  async generateProceduralScene({
    context = {},
    requestedSceneId = "",
    reason = "",
  } = {}) {
    const currentSceneId =
      String(context.currentScene?.sceneId ?? "start").trim() || "start";
    const fallbackSceneId =
      String(requestedSceneId ?? "").trim() || `generated_scene_${Date.now()}`;

    const fallback = {
      sceneId: fallbackSceneId,
      type: "narrative",
      vibe: "generated_detour",
      text: "A ködben új ösvény nyílik előtted, ismeretlen veszélyekkel és lehetőségekkel.",
      choices: [
        {
          text: "Visszatérek az ismert útra.",
          nextScene: currentSceneId,
        },
      ],
    };

    try {
      const prompt = [
        "A játékos letért az előre megírt útról. Generálj egy új, konzisztens jelenetet a worldState és a pillangó-effektek alapján. Határozz meg új választási lehetőségeket vagy Skill Check-eket.",
        "A válasz KIZÁRÓLAG valid JSON legyen.",
        "Séma:",
        '{"sceneId":"string","type":"narrative|interrogation|skill_check|combat","vibe":"string","text":"string","context":"string","character":"string","onLeave":"string","encounterId":"string","skill":"string","difficulty":number,"onSuccess":"string","onFailure":"string","choices":[{"text":"string","nextScene":"string","setFlag":{},"setVariable":{}}]}',
        "Követelmények:",
        "- A sceneId legyen egyedi, rövid azonosító.",
        "- A text mező legyen 1-3 mondatos, sötét fantasy stílusú.",
        "- A choices tömb legalább 1 opciót tartalmazzon, ha a type nem skill_check.",
        "- skill_check típusnál add meg a skill, difficulty, onSuccess és onFailure mezőket.",
        `Kért (nem létező) sceneId: ${fallbackSceneId}`,
        `Eltérés oka: ${String(reason || "nincs megadva")}`,
        `Aktív jelenet: ${JSON.stringify(context.currentScene ?? {})}`,
        `WorldState flags: ${JSON.stringify(context.worldState?.flags ?? {})}`,
        `WorldState variables: ${JSON.stringify(context.worldState?.variables ?? {})}`,
        `WorldState npcAffinity: ${JSON.stringify(context.worldState?.npcAffinity ?? {})}`,
      ].join("\n");

      const result = await this._generateContentWithFallback("cyborg", prompt);
      const raw = result.response.text();
      const parsed = this._parseJsonObject(raw);
      if (!parsed) return fallback;

      return this._normaliseGeneratedScene(parsed, {
        fallbackSceneId,
        currentSceneId,
      });
    } catch (error) {
      console.error("[GeminiDMService] generateProceduralScene hiba:", error);
      return fallback;
    }
  }

  _normaliseGeneratedScene(rawScene, { fallbackSceneId, currentSceneId }) {
    const scene = rawScene && typeof rawScene === "object" ? rawScene : {};
    const type = String(scene.type ?? "narrative")
      .trim()
      .toLowerCase();
    const allowedTypes = new Set([
      "narrative",
      "interrogation",
      "skill_check",
      "combat",
    ]);
    const safeType = allowedTypes.has(type) ? type : "narrative";

    const normalised = {
      sceneId:
        String(scene.sceneId ?? "").trim() ||
        String(fallbackSceneId ?? "").trim() ||
        `generated_scene_${Date.now()}`,
      type: safeType,
      vibe:
        String(scene.vibe ?? "generated_detour").trim() || "generated_detour",
      text:
        String(scene.text ?? "").trim() ||
        "A történet új, előre nem látott fordulatot vett.",
      context: String(scene.context ?? "").trim(),
      character: String(scene.character ?? "").trim(),
      onLeave: String(scene.onLeave ?? "").trim() || currentSceneId,
      encounterId: String(scene.encounterId ?? "").trim() || null,
      skill: String(scene.skill ?? "").trim() || null,
      difficulty: Number(scene.difficulty ?? scene.dc ?? 0) || null,
      dc: Number(scene.dc ?? scene.difficulty ?? 0) || null,
      onSuccess: String(scene.onSuccess ?? "").trim() || currentSceneId,
      onFailure: String(scene.onFailure ?? "").trim() || currentSceneId,
      choices: Array.isArray(scene.choices)
        ? scene.choices
            .map((choice) => {
              if (!choice || typeof choice !== "object") return null;
              const text = String(choice.text ?? "").trim();
              if (!text) return null;

              return {
                text,
                nextScene:
                  String(choice.nextScene ?? "").trim() || currentSceneId,
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
    };

    if (normalised.type !== "skill_check" && normalised.choices.length === 0) {
      normalised.choices.push({
        text: "Visszalépek a biztos útra.",
        nextScene: currentSceneId,
      });
    }

    if (normalised.type === "combat" && !normalised.encounterId) {
      normalised.type = "narrative";
      normalised.choices = [
        {
          text: "Visszatérek az ismert ösvényre.",
          nextScene: currentSceneId,
        },
      ];
    }

    return normalised;
  }

  _normaliseHybridSkillCheck(skillCheck) {
    if (!skillCheck || typeof skillCheck !== "object") return null;

    const ability = String(skillCheck.ability ?? "")
      .trim()
      .toLowerCase();
    const dcRaw = Number(skillCheck.dc);
    const dc = Number.isFinite(dcRaw) ? Math.max(1, Math.floor(dcRaw)) : 10;

    const successScene = String(skillCheck.successScene ?? "").trim();
    const failScene = String(skillCheck.failScene ?? "").trim();

    if (!ability || !successScene || !failScene) return null;

    return {
      ability,
      dc,
      successScene,
      failScene,
    };
  }

  _normaliseHybridRewards(rewards) {
    if (!rewards || typeof rewards !== "object") return null;

    const xpRaw = Number(rewards.xp ?? 0);
    const goldRaw = Number(rewards.gold ?? 0);
    const xp = Number.isFinite(xpRaw) ? Math.max(0, Math.floor(xpRaw)) : 0;
    const gold = Number.isFinite(goldRaw)
      ? Math.max(0, Math.floor(goldRaw))
      : 0;
    const items = Array.isArray(rewards.items)
      ? rewards.items.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];

    if (!xp && !gold && items.length === 0) return null;

    return {
      xp,
      gold,
      items,
    };
  }

  _normaliseHybridAffinityUpdate(affinityUpdate) {
    if (!affinityUpdate || typeof affinityUpdate !== "object") return null;

    const npcId = String(affinityUpdate.npcId ?? "").trim();
    const deltaRaw = Number(affinityUpdate.delta);
    const delta = Number.isFinite(deltaRaw) ? Math.round(deltaRaw) : 0;

    if (!npcId || delta === 0) return null;

    return {
      npcId,
      delta,
    };
  }

  _normaliseHybridTimeDelta(timeDelta) {
    const raw = Number(timeDelta);
    if (!Number.isFinite(raw)) return 5;
    return Math.max(0, Math.min(24 * 60, Math.floor(raw)));
  }

  _normaliseHybridFactionUpdates(factionUpdates) {
    if (!Array.isArray(factionUpdates)) return [];

    return factionUpdates
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

  _normaliseHybridAudioProfile(audioProfile) {
    if (!audioProfile || typeof audioProfile !== "object") return null;

    const ambient = String(audioProfile.ambient ?? "").trim();
    const musicMood = String(audioProfile.musicMood ?? "").trim();
    if (!ambient && !musicMood) return null;

    return {
      ambient,
      musicMood,
    };
  }

  async repromptSkillCheckOutcome({
    context = {},
    skillCheck = {},
    rollTotal = 0,
    success = false,
    targetSceneId = "",
  } = {}) {
    const fallback = {
      narration: success
        ? "A próba épphogy sikerült, és a történet új lendületet kapott."
        : "A próba elbukott, és a világ sötétebb irányba fordult.",
      audioCue: "A kocka ítélete eldőlt.",
      logic: {
        flags: [],
        variables: [],
      },
      transition: "STORY",
      nextSceneId: "",
      encounterId: "",
      skillCheck: null,
      rewards: null,
      affinityUpdate: null,
      timeDelta: 0,
      factionUpdates: [],
      audioProfile: null,
      audioOutput: null,
    };

    try {
      const prompt = [
        "Előző döntésed skill check gate-et használt.",
        "Most KIZÁRÓLAG a dobás kimenetét narráld a megadott JSON sémában.",
        `Séma: ${HYBRID_JSON_SCHEMA}`,
        "Ne kérj újabb skillCheck-et (skillCheck legyen null vagy hiányozzon).",
        `Játékos input: ${String(context.playerInput ?? "")}`,
        `Skill check ability: ${String(skillCheck.ability ?? "")}`,
        `DC: ${Number(skillCheck.dc ?? 10)}`,
        `Dobás eredménye: ${Number(rollTotal ?? 0)}`,
        `Kimenet: ${success ? "SUCCESS" : "FAIL"}`,
        `Betöltött jelenet: ${String(targetSceneId ?? "")}`,
        `Jelenlegi idő: ${String(context.worldTimeLabel ?? "ismeretlen")}`,
        `Jelenlegi napszak: ${String(context.worldState?.timeOfDay ?? "Day")}`,
        `WorldState flags: ${JSON.stringify(context.worldState?.flags ?? {})}`,
        `WorldState variables: ${JSON.stringify(context.worldState?.variables ?? {})}`,
        `WorldState factions: ${JSON.stringify(context.worldState?.factions ?? {})}`,
        `WorldState npcAffinity: ${JSON.stringify(context.worldState?.npcAffinity ?? {})}`,
      ].join("\n");

      const result = await this._generateContentWithFallback("cyborg", prompt);
      const raw = result.response.text();
      const parsed = this._parseJsonObject(raw);

      if (!parsed) {
        return {
          ...fallback,
          narration: String(raw ?? "").trim() || fallback.narration,
        };
      }

      return {
        narration:
          typeof parsed.narration === "string" && parsed.narration.trim()
            ? parsed.narration.trim()
            : fallback.narration,
        audioCue:
          typeof parsed.audioCue === "string" ? parsed.audioCue.trim() : "",
        logic:
          parsed.logic && typeof parsed.logic === "object"
            ? {
                flags:
                  Array.isArray(parsed.logic.flags) ||
                  (parsed.logic.flags && typeof parsed.logic.flags === "object")
                    ? parsed.logic.flags
                    : [],
                variables:
                  Array.isArray(parsed.logic.variables) ||
                  (parsed.logic.variables &&
                    typeof parsed.logic.variables === "object")
                    ? parsed.logic.variables
                    : [],
              }
            : fallback.logic,
        transition: "STORY",
        nextSceneId:
          typeof parsed.nextSceneId === "string"
            ? parsed.nextSceneId.trim()
            : "",
        encounterId: "",
        skillCheck: null,
        rewards: this._normaliseHybridRewards(parsed.rewards),
        affinityUpdate: this._normaliseHybridAffinityUpdate(
          parsed.affinityUpdate,
        ),
        timeDelta: this._normaliseHybridTimeDelta(parsed.timeDelta),
        factionUpdates: this._normaliseHybridFactionUpdates(
          parsed.factionUpdates,
        ),
        audioProfile: this._normaliseHybridAudioProfile(parsed.audioProfile),
        audioOutput:
          typeof parsed.audioOutput === "string" ? parsed.audioOutput : null,
      };
    } catch (error) {
      console.error("[GeminiDMService] repromptSkillCheckOutcome hiba:", error);
      return fallback;
    }
  }

  async playCyborgAudio({ audioCue, audioOutput } = {}) {
    if (typeof audioOutput === "string" && audioOutput.trim()) {
      await this.playAudio(audioOutput);
      return;
    }

    const cue = String(audioCue ?? "").trim();
    if (!cue) return;

    await this._speakCue(cue);
  }

  _speakCue(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "hu-HU";
      utterance.rate = 0.96;
      utterance.pitch = 0.88;

      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  async summarizeFlagChange({ flag, value, worldState } = {}) {
    const fallback = `A krónikák új jelet őriznek: ${flag} = ${value ? "igaz" : "hamis"}.`;

    if (!flag) return fallback;

    try {
      const activeFlags = Object.entries(worldState?.flags ?? {})
        .filter(([, isActive]) => isActive === true)
        .map(([key]) => key)
        .slice(0, 8)
        .join(", ");

      const prompt = [
        "Írj egyetlen, legfeljebb 22 szavas magyar mondatot, sötét fantasy krónika stílusban.",
        "Nem kell JSON, csak maga a mondat.",
        `Vibe: ${this.currentVibe}`,
        `Megváltozott flag: ${flag}`,
        `Új érték: ${value ? "igaz" : "hamis"}`,
        `Aktív flag-ek: ${activeFlags || "nincs"}`,
      ].join("\n");

      const result = await this._generateContentWithFallback("utility", prompt);
      const summary = String(result.response.text() ?? "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .replace(/\s+/g, " ")
        .trim();

      return summary || fallback;
    } catch (error) {
      console.error("[GeminiDMService] summarizeFlagChange hiba:", error);
      return fallback;
    }
  }

  _buildWorldStateContext() {
    const currentState = campaignManager.getWorldState();
    const activeFlags = Object.entries(currentState?.flags ?? {})
      .filter(([, value]) => value === true)
      .map(([key]) => key);

    const activeVariables = Object.entries(currentState?.variables ?? {}).map(
      ([key, value]) => `${key}: ${value}`,
    );

    const flagText =
      activeFlags.length > 0 ? activeFlags.join(", ") : "nincs aktív flag";
    const variableText =
      activeVariables.length > 0
        ? activeVariables.join(", ")
        : "nincs releváns változó";

    const affinityPairs = Object.entries(currentState?.npcAffinity ?? {}).map(
      ([npcId, value]) => `${npcId}: ${value}`,
    );
    const affinityText =
      affinityPairs.length > 0
        ? affinityPairs.join(", ")
        : "nincs ismert affinity érték";

    const factionPairs = Object.entries(currentState?.factions ?? {}).map(
      ([faction, value]) => `${faction}: ${value}`,
    );
    const factionText =
      factionPairs.length > 0
        ? factionPairs.join(", ")
        : "nincs ismert frakció-érték";

    const time = currentState?.time ?? { day: 1, hour: 8, minute: 0 };
    const day = Number(time.day ?? 1);
    const hour = String(Number(time.hour ?? 8)).padStart(2, "0");
    const minute = String(Number(time.minute ?? 0)).padStart(2, "0");
    const timeOfDay = campaignManager.getTimeOfDay?.(time) ?? "Day";
    const timeText = `Nap ${day}, ${hour}:${minute} (${timeOfDay})`;

    return `Aktuális vibe: ${this.currentVibe}\nJelenlegi idő: [${timeText}]\nJelenlegi worldState flagek: [${flagText}]\nJelenlegi worldState változók: [${variableText}]\nJelenlegi frakció reputáció: [${factionText}]\nJelenlegi npcAffinity értékek: [${affinityText}]`;
  }

  _parseJsonObject(responseText) {
    const trimmed = String(responseText ?? "").trim();
    if (!trimmed) return null;

    const unfenced = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    const jsonStart = unfenced.indexOf("{");
    const jsonEnd = unfenced.lastIndexOf("}");

    const jsonPayload =
      jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart
        ? unfenced.slice(jsonStart, jsonEnd + 1)
        : unfenced;

    try {
      const parsed = JSON.parse(jsonPayload);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  _parseNarrationResponse(responseText) {
    const trimmed = (responseText ?? "").trim();
    if (!trimmed) return null;

    const unfenced = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");

    const jsonStart = unfenced.indexOf("{");
    const jsonEnd = unfenced.lastIndexOf("}");

    const jsonPayload =
      jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart
        ? unfenced.slice(jsonStart, jsonEnd + 1)
        : unfenced;

    let parsed;
    try {
      parsed = JSON.parse(jsonPayload);
    } catch (error) {
      console.warn(
        "[GeminiDMService] A modell válasza nem valid JSON, fallback szöveg kerül használatra.",
        error,
      );

      return { text: unfenced };
    }

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      text: typeof parsed.text === "string" ? parsed.text.trim() : "",
      audioOutput:
        typeof parsed.audioOutput === "string" ? parsed.audioOutput : null,
    };
  }

  displayText(text) {
    if (!text) return;

    void eventBus.publish(EVENTS.NARRATION_RECEIVED, {
      text,
      color: "gold",
    });
  }

  async playAudio(base64Audio) {
    if (!base64Audio) return;

    try {
      const audioContext = this._ensureAudioContext();
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      const rawBase64 = String(base64Audio).includes(",")
        ? String(base64Audio).split(",").pop()
        : String(base64Audio);

      const binaryString = window.atob(rawBase64.replace(/\s/g, ""));
      const byteArray = new Uint8Array(binaryString.length);
      for (let index = 0; index < binaryString.length; index += 1) {
        byteArray[index] = binaryString.charCodeAt(index);
      }

      const audioBuffer = await audioContext.decodeAudioData(
        byteArray.buffer.slice(0),
      );

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
    } catch (error) {
      console.error(
        "[GeminiDMService] Hiba az audio lejátszása közben:",
        error,
      );
    }
  }

  _ensureAudioContext() {
    if (this.audioContext) return this.audioContext;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("A böngésző nem támogatja a Web Audio API-t.");
    }

    this.audioContext = new AudioContextCtor();
    return this.audioContext;
  }
}

function _createGeminiService() {
  try {
    const apiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? "").trim();
    return new GeminiDMService(apiKey);
  } catch (error) {
    console.warn(
      "[GeminiDMService] Nem aktiválható (hiányzó vagy hibás API kulcs).",
      error,
    );
    return null;
  }
}

export const geminiDMService = _createGeminiService();
