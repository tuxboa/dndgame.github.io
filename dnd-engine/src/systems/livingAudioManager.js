import { eventBus, EVENTS } from "../engine/eventBus.js";
import { setMusic } from "./audioSystem.js";

let _initialized = false;
let _currentAmbient = "";
let _currentTrack = "";

const AMBIENT_BY_TIME_OF_DAY = {
  Dawn: "Hajnali piacnyitás és madárcsicsergés",
  Day: "Nappali utcazaj és kereskedők kiáltása",
  Dusk: "Alkonyati harangszó és halk moraj",
  Night: "Éjszakai szélzúgás és távoli léptek",
};

const TRACK_BY_MOOD = {
  calm: "town",
  social: "town",
  market: "town",
  tense: "dungeon",
  mystery: "dungeon",
  danger: "combat",
  battle: "combat",
  boss: "boss",
};

function _normaliseText(value) {
  return String(value ?? "").trim();
}

function _resolveAmbient(timeOfDay) {
  const key = _normaliseText(timeOfDay);
  return AMBIENT_BY_TIME_OF_DAY[key] ?? AMBIENT_BY_TIME_OF_DAY.Day;
}

function _resolveTrackFromProfile(musicMood, scene = {}) {
  const moodKey = _normaliseText(musicMood).toLowerCase();
  if (moodKey && TRACK_BY_MOOD[moodKey]) return TRACK_BY_MOOD[moodKey];

  const sceneType = _normaliseText(scene.type).toLowerCase();
  if (sceneType === "combat") return "combat";

  const vibe = _normaliseText(scene.vibe).toLowerCase();
  if (
    vibe.includes("town") ||
    vibe.includes("market") ||
    vibe.includes("tavern")
  ) {
    return "town";
  }
  if (vibe.includes("boss")) return "boss";
  return "dungeon";
}

function _setAmbient(ambient, source = "audio-manager") {
  const text = _normaliseText(ambient);
  if (!text || text === _currentAmbient) return;

  _currentAmbient = text;
  console.log(`[LivingAudioManager] ambient → ${text} (${source})`);
}

function _setMoodTrack(musicMood, scene = {}, source = "audio-manager") {
  const track = _resolveTrackFromProfile(musicMood, scene);
  if (!track || track === _currentTrack) return;

  _currentTrack = track;
  setMusic(track);
  console.log(
    `[LivingAudioManager] music track → ${track} (mood: ${_normaliseText(musicMood) || "auto"}, source: ${source})`,
  );
}

function _handleSceneLoaded(payload = {}) {
  const scene = payload.scene ?? {};
  _setMoodTrack(scene.vibe ?? scene.type ?? "", scene, "scene-loaded");
}

function _handleTimeOfDayChanged(payload = {}) {
  const nextTimeOfDay =
    _normaliseText(payload.nextTimeOfDay) ||
    _normaliseText(payload.timeOfDay) ||
    "Day";
  _setAmbient(_resolveAmbient(nextTimeOfDay), "time-of-day");
}

function _handleAudioProfileSuggested(payload = {}) {
  const ambient = _normaliseText(payload.ambient);
  const musicMood = _normaliseText(payload.musicMood);

  if (ambient) _setAmbient(ambient, "dm-profile");
  if (musicMood) _setMoodTrack(musicMood, payload.scene ?? {}, "dm-profile");
}

export function initLivingAudioManager() {
  if (_initialized) return;
  _initialized = true;

  eventBus.on(EVENTS.SCENE_LOADED, _handleSceneLoaded, { priority: -85 });
  eventBus.on(EVENTS.TIME_OF_DAY_CHANGED, _handleTimeOfDayChanged, {
    priority: -85,
  });
  eventBus.on(EVENTS.AUDIO_PROFILE_SUGGESTED, _handleAudioProfileSuggested, {
    priority: -85,
  });
}
