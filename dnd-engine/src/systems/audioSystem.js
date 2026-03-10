/**
 * audioSystem.js — HTML5 Audio engine for SFX and background music.
 *
 * PUBLIC API
 * ──────────────────────────────────────────────────────────────────
 *  initAudio()           Call once at bootstrap. Defers music until first
 *                        user gesture to satisfy autoplay policy.
 *  playSFX(soundId)      Play a one-shot sound effect (overlapping allowed).
 *  setMusic(trackId)     Crossfade background music to a new track.
 *  toggleMute()          Toggle global mute (preserves music position).
 *  setMusicVolume(v)     0–1
 *  setSfxVolume(v)       0–1
 *  isMuted()             Returns current mute state.
 *  NODE_MUSIC            Record<nodeId, trackId> — exported for storyManager.
 */

import { eventBus, EVENTS } from "../engine/eventBus.js";

// ── Asset maps ─────────────────────────────────────────────────────────────────

const SFX_MAP = {
  attack: "assets/audio/sfx/attack.mp3",
  attack_hit: "assets/audio/sfx/hit.mp3",
  spell: "assets/audio/sfx/spell.mp3",
  spell_heal: "assets/audio/sfx/heal.mp3",
  buy: "assets/audio/sfx/coins.mp3",
  sell: "assets/audio/sfx/coins.mp3",
  level_up: "assets/audio/sfx/levelup.mp3",
  item_pickup: "assets/audio/sfx/pickup.mp3",
  ui_click: "assets/audio/sfx/click.mp3",
  dice: "assets/audio/sfx/dice.mp3",
  door: "assets/audio/sfx/door.mp3",
  error: "assets/audio/sfx/error.mp3",
  victory: "assets/audio/sfx/victory.mp3",
  death: "assets/audio/sfx/death.mp3",
};

const MUSIC_MAP = {
  menu: "assets/audio/music/menu.mp3",
  town: "assets/audio/music/town.mp3",
  combat: "assets/audio/music/combat.mp3",
  dungeon: "assets/audio/music/dungeon.mp3",
  boss: "assets/audio/music/boss.mp3",
};

/**
 * Maps story node IDs to music track IDs.
 * Exported so storyManager can use it without hard-coding node names here.
 * @type {Record<string, string>}
 */
export const NODE_MUSIC = {
  town_gate: "town",
  tavern: "town",
  quest_board: "town",
  alley_ambush: "dungeon",
  alley_success: "town",
  dungeon_entrance: "dungeon",
  dungeon_corridor: "dungeon",
  dungeon_vault: "dungeon",
  boss_room: "boss",
  quest_complete: "town",
};

// ── Private state ──────────────────────────────────────────────────────────────

let _muted = false;
let _sfxVolume = 0.7;
let _musicVolume = 0.35;

/** @type {HTMLAudioElement | null} */
let _currentMusic = null;
let _currentTrackId = null;

const FADE_STEP_MS = 50; // tick interval
const FADE_STEPS = 20; // 20 × 50ms = 1 000 ms total fade

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialise the audio system.
 * Browsers block autoplay until a user gesture — we listen for the first
 * click/keydown and start music then if a track was queued beforehand.
 */
export function initAudio() {
  // Unlock on first gesture so music can start automatically after.
  const onGesture = () => {
    document.removeEventListener("click", onGesture);
    document.removeEventListener("keydown", onGesture);
    // If a track was already queued via setMusic() before the gesture, re-try.
    if (_currentTrackId && _currentMusic && _currentMusic.paused) {
      _currentMusic
        .play()
        .then(() => {
          if (!_muted) _fadeIn(_currentMusic, _musicVolume);
        })
        .catch(() => {});
    }
    console.log("[AudioSystem] Unlocked by user gesture.");
  };
  document.addEventListener("click", onGesture, { once: true });
  document.addEventListener("keydown", onGesture, { once: true });

  // ── Automatikus SFX eseményekre ─────────────────────────────────────
  // Ezeket az eventBus-on keresztül vesszük, így a játék bármely részéből
  // triggerelhetők anélkül, hogy az audioSystem-et közvetlenül importálnák.
  eventBus.on(EVENTS.QUEST_COMPLETED, () => playSFX("item_pickup"));
  eventBus.on(EVENTS.QUEST_ADDED, () => playSFX("ui_click"));
  eventBus.on(EVENTS.LEVEL_UP_READY, () => playSFX("level_up"));
  eventBus.on(EVENTS.INVENTORY_CHANGED, ({ action }) => {
    if (action === "add") playSFX("item_pickup");
  });
  eventBus.on(EVENTS.STORY_NODE_CHANGED, () => playSFX("door"));
  eventBus.on(EVENTS.ITEM_EQUIPPED, () => playSFX("ui_click"));
  eventBus.on(EVENTS.ITEM_UNEQUIPPED, () => playSFX("ui_click"));
  eventBus.on(EVENTS.COMBAT_STARTED, () => playSFX("attack"));

  console.log("[AudioSystem] Initialised — waiting for user gesture.");
}

/**
 * Play a one-shot sound effect.
 * A new Audio element is created per call so sounds can overlap freely.
 * @param {string} soundId
 */
export function playSFX(soundId) {
  if (_muted) return;
  const src = SFX_MAP[soundId];
  if (!src) {
    console.warn(`[AudioSystem] Unknown SFX: "${soundId}"`);
    return;
  }
  const audio = new Audio(src);
  audio.volume = _sfxVolume;
  audio.play().catch(() => {}); // Silence autoplay-policy errors silently
}

/**
 * Crossfade background music to the given track.
 * No-op when the requested track is already playing.
 * @param {string} trackId
 */
export function setMusic(trackId) {
  if (trackId === _currentTrackId) return;
  const src = MUSIC_MAP[trackId];
  if (!src) {
    console.warn(`[AudioSystem] Unknown music track: "${trackId}"`);
    return;
  }

  _currentTrackId = trackId;

  // Fade out and stop the outgoing track
  const outgoing = _currentMusic;
  if (outgoing) {
    _fadeOut(outgoing, () => {
      outgoing.pause();
      outgoing.src = "";
    });
  }

  // Start the incoming track
  const incoming = new Audio(src);
  incoming.loop = true;
  incoming.volume = 0; // Starts silent; fades in after play() resolves
  _currentMusic = incoming;

  incoming
    .play()
    .then(() => {
      if (!_muted) _fadeIn(incoming, _musicVolume);
    })
    .catch(() => {
      // Autoplay blocked — initAudio()'s gesture listener will retry.
    });
}

/** Toggle global mute for SFX and music. Returns the new mute state. */
export function toggleMute() {
  _muted = !_muted;
  if (_currentMusic) {
    _currentMusic.volume = _muted ? 0 : _musicVolume;
  }
  return _muted;
}

/** @returns {boolean} */
export function isMuted() {
  return _muted;
}

/**
 * @param {number} v  0–1
 */
export function setMusicVolume(v) {
  _musicVolume = Math.max(0, Math.min(1, v));
  if (_currentMusic && !_muted) _currentMusic.volume = _musicVolume;
}

/**
 * @param {number} v  0–1
 */
export function setSfxVolume(v) {
  _sfxVolume = Math.max(0, Math.min(1, v));
}

/**
 * Speak a combat-narration line via the TTS voice (GCP en-GB-Wavenet-B).
 * Thin facade so callers only need to import audioSystem, not ttsSystem.
 * Uses a dynamic import to avoid a circular dependency between the two systems.
 *
 * @param {string} text  English narration text (plain or Markdown)
 * @returns {Promise<void>}
 */
export async function speakCombatLine(text) {
  try {
    const { speakNarration } = await import("./ttsSystem.js");
    return speakNarration(text);
  } catch (err) {
    console.warn("[AudioSystem] speakCombatLine failed:", err.message);
  }
}

// ── Private helpers ────────────────────────────────────────────────────────────

/**
 * Linearly ramp audio.volume from 0 up to targetVolume over FADE_STEPS ticks.
 * @param {HTMLAudioElement} audio
 * @param {number} targetVolume
 */
function _fadeIn(audio, targetVolume) {
  audio.volume = 0;
  let step = 0;
  const id = setInterval(() => {
    step++;
    audio.volume = Math.min(targetVolume, (step / FADE_STEPS) * targetVolume);
    if (step >= FADE_STEPS) clearInterval(id);
  }, FADE_STEP_MS);
}

/**
 * Linearly ramp audio.volume from its current level down to 0, then call onDone.
 * @param {HTMLAudioElement} audio
 * @param {() => void} onDone
 */
function _fadeOut(audio, onDone) {
  const startVol = audio.volume;
  let step = 0;
  const id = setInterval(() => {
    step++;
    audio.volume = Math.max(0, startVol * (1 - step / FADE_STEPS));
    if (step >= FADE_STEPS) {
      clearInterval(id);
      onDone();
    }
  }, FADE_STEP_MS);
}
