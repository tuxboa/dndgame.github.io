import { eventBus, EVENTS } from "./eventBus.js";
import { geminiDMService } from "../services/GeminiDMService.js";
import { setMusic } from "../systems/audioSystem.js";

const VIBE_PRESETS = {
  default: {
    accentVar: "--color-accent",
    bgFilter: "none",
    fontVar: "--font-body",
    music: null,
  },
  tense_castle_gate: {
    accentVar: "--color-accent-dim",
    bgFilter: "sepia(0.2) brightness(0.9)",
    fontVar: "--font-title",
    music: "dungeon",
  },
  noir_interrogation: {
    accentVar: "--color-danger",
    bgFilter: "grayscale(1) contrast(1.2)",
    fontVar: "--font-ui",
    music: "dungeon",
  },
  stealth_success: {
    accentVar: "--color-success",
    bgFilter: "brightness(1.1)",
    fontVar: "--font-body",
    music: "town",
  },
};

let _initialized = false;
let _currentVibe = "default";

function _readCssVar(varName) {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return value || "";
}

function _setAtmosphereVars({ accentVar, bgFilter, fontVar }) {
  const root = document.documentElement;
  const accentValue = _readCssVar(accentVar);
  const fontValue = _readCssVar(fontVar);

  root.style.setProperty(
    "--atmo-accent-color",
    accentValue || _readCssVar("--color-accent"),
  );
  root.style.setProperty("--atmo-bg-filter", bgFilter || "none");
  root.style.setProperty(
    "--atmo-font-style",
    fontValue || _readCssVar("--font-body"),
  );
}

function _applyVibe(vibeName) {
  const preset = VIBE_PRESETS[vibeName] ?? VIBE_PRESETS.default;
  _currentVibe = vibeName in VIBE_PRESETS ? vibeName : "default";

  _setAtmosphereVars(preset);

  if (preset.music) {
    setMusic(preset.music);
  }

  geminiDMService?.setCurrentVibe?.(_currentVibe);

  eventBus.emit(EVENTS.ATMOSPHERE_CHANGED, {
    vibe: _currentVibe,
    preset,
  });
}

export function initAtmosphereSystem() {
  if (_initialized) return;
  _initialized = true;

  eventBus.on(EVENTS.SCENE_LOADED, ({ scene }) => {
    const sceneVibe = scene?.vibe ?? "default";
    if (sceneVibe !== _currentVibe) {
      _applyVibe(sceneVibe);
    }
  });

  _applyVibe("default");
}

export function getCurrentVibe() {
  return _currentVibe;
}
