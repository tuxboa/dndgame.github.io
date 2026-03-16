import { GoogleGenerativeAI } from "@google/generative-ai";

import { eventBus, EVENTS } from "../engine/eventBus.js";
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

    this.audioContext = null;
    this.attackCounter = 0;
    this.narrationInterval = _resolveNarrationInterval();
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
      const prompt = `Generálj egy narrációt a következő eseményről:\n- Támadó: ${combatData.attacker.name}\n- Célpont: ${combatData.defender.name}\n- Sebzés: ${combatData.damage}\n- Fegyver: ${combatData.weaponName}\n- Kritikus találat: ${combatData.isCritical ? "Igen" : "Nem"}\n- Halálos csapás: ${combatData.isFatal ? "Igen" : "Nem"}`;

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
