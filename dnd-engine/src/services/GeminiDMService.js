import { GoogleGenerativeAI } from "@google/generative-ai";

import { eventBus, EVENTS } from "../engine/eventBus.js";
import { campaignManager } from "../engine/CampaignManager.js";
import { gameStore } from "../store/index.js";

const DEFAULT_NARRATION_INTERVAL = 3;

const SYSTEM_INSTRUCTION = `Te egy sötét fantasy Dungeon Master vagy. Rövid, velős, 10-15 szavas magyar nyelvű leírásokat generálj a harci eseményekről. A válaszod MINDIG egy valid JSON objektum legyen, ami tartalmaz egy 'text' mezőt a narrációnak és egy 'audioOutput' mezőt, ami a base64 kódolt hangfájlt tartalmazza. A hang stílusa legyen mély, rekedtes és gótikus.`;

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

class GeminiDMService {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error("Gemini API kulcs hiányzik!");
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    this.utilityModel = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    this.audioContext = null;
    this.attackCounter = 0;
    this.narrationInterval = _resolveNarrationInterval();
    this.currentVibe = "default";
    this._initialized = false;
    this._boundDamageHandler = this.handleDamageEvent.bind(this);
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

      const result = await this.model.generateContent(prompt);
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

      const result = await this.model.generateContent(prompt);
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

      const result = await this.utilityModel.generateContent(prompt);
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

      const result = await this.utilityModel.generateContent(prompt);
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

    return `Aktuális vibe: ${this.currentVibe}\nJelenlegi worldState flagek: [${flagText}]\nJelenlegi worldState változók: [${variableText}]`;
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
