/**
 * ttsSystem.js — Google Cloud Text-to-Speech for the AI Dungeon Master.
 *
 * Sends English narration (narration_en) to the GCP TTS REST API and plays
 * back the returned MP3. Hungarian text (narration_hu) is written to the
 * on-screen narrative log only — it is NEVER passed here.
 *
 * Voice  : en-GB-Neural2-B  (British male Neural — deep wizard narrator)
 * Effect : SSML prosody — pitch −20Hz, rate −15%
 *          Dramatic <break time="500ms"/> injected after the first sentence.
 *
 * Usage quota: GCP free tier = 1 000 000 Neural chars / month.
 * Usage is tracked in localStorage (key: "dnd_tts_usage").
 *
 * PUBLIC API
 * ──────────────────────────────────────────────────────────────────────────────
 *  initTTS(apiKey)         Wire DM_RESPONSE_RECEIVED listener; set GCP key.
 *  speakNarration(text)    Queue and speak one English DM narration.
 *  stopNarration()         Stop current audio; discard pending queue.
 *  toggleTtsMute()         Toggle global DM-voice mute. Returns new state.
 *  isTtsMuted()            Returns boolean.
 *  getMonthlyUsage()       { used, budget, month } for the Settings UI.
 *  setTtsKey(key)          Update the GCP API key at runtime.
 *  restoreTtsKey()         Restore key from sessionStorage.
 */

import { eventBus, EVENTS } from "../engine/eventBus.js";
import { getTtsKey, saveTtsKey } from "../config/apiConfig.js";

// ── Config ─────────────────────────────────────────────────────────────────────

/** GCP TTS REST endpoint. */
const GCP_TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

/** en-GB-Neural2-B — prémium brit férfi Neural hang, mély DM narrátor. */
const VOICE_NAME = "en-GB-Neural2-B";
const LANG_CODE = "en-GB";

/**
 * GCP audioConfig paraméterek.
 * Neural2 hangok NEM támogatják az SSML <prosody pitch> Hz-es módját —
 * ezért a pitch és speakingRate az audioConfig-ban kerül beállításra.
 *
 *  pitch        : -6.0  → mélyebb, tekintélyt parancsoló hang  (-20.0 – +20.0 félhang)
 *  speakingRate : 0.69  → lassú, mesélős tempó                 (0.25 – 4.0)
 */
const AUDIO_PITCH = -6.0;
const AUDIO_SPEAKING_RATE = 0.69;

/** GCP free tier: 1 M Neural karakter / hó. */
const MONTHLY_BUDGET = 1_000_000;
const USAGE_LS_KEY = "dnd_tts_usage";

/** Master volume for the narration audio element. */
const NARRATION_VOLUME = 0.9;

// ── Private state ──────────────────────────────────────────────────────────────

/** GCP API key — loaded from localStorage via apiConfig; set in-game via the ⚙️ Settings modal. */
let _apiKey = getTtsKey();

// TTS alapból le van némítva — ne égesszük a GCP kvótát a fejlesztés alatt.
// A Settings modálban a játékos bekapcsolhatja.
let _muted = true;
let _listenersWired = false;

/**
 * Monotonically incrementing generation counter.
 * Incremented by stopNarration() to invalidate in-flight _playOnce() calls.
 */
let _generation = 0;

/**
 * Serialised promise chain — guarantees narrations play one-at-a-time
 * and in order even when multiple DM responses arrive quickly.
 * @type {Promise<void>}
 */
let _queue = Promise.resolve();

/** Currently playing Audio element — null when idle. */
/** @type {HTMLAudioElement | null} */
let _currentAudio = null;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initialise TTS. Call once from bootstrap.
 * Safe to call multiple times — listeners are registered only on the first call.
 * If apiKey is provided it overrides the built-in key (useful for runtime key injection).
 *
 * @param {string | null} [apiKey]
 */
export function initTTS(apiKey) {
  if (apiKey) _apiKey = apiKey;

  if (_listenersWired) return;
  _listenersWired = true;

  // Auto-speak the English translation field — narration_hu is displayed on screen.
  // Only speak for significant story moments, not trivial scene descriptions.
  eventBus.on(EVENTS.DM_RESPONSE_RECEIVED, ({ narration_en }) => {
    if (narration_en && _isSignificantNarration(narration_en))
      speakNarration(narration_en).catch(() => {});
  });

  console.log("[TTS] Initialised — GCP voice:", VOICE_NAME);
}

/**
 * Update the GCP TTS API key at runtime (called from the Settings modal).
 * Persists to sessionStorage so it survives page refresh within the tab.
 * @param {string} key
 */
export function setTtsKey(key) {
  const trimmed = (key ?? "").trim();
  _apiKey = trimmed;
  saveTtsKey(trimmed);
}

/**
 * Restore TTS key from localStorage (persistent across sessions).
 * Returns "" when no key has been saved yet.
 * @returns {string}
 */
export function restoreTtsKey() {
  return getTtsKey();
}

/**
 * Queue a narration for playback.
 * Calls are serialised — a new call waits for the current one to finish.
 * No-op when muted or no API key is set.
 *
 * @param {string} text  Plain English narration text (may contain Markdown).
 * @returns {Promise<void>}
 */
export function speakNarration(text) {
  if (_muted) return Promise.resolve();

  // ── No GCP key → Web Speech API fallback ─────────────────────────────────
  if (!_apiKey) {
    _queue = _queue.then(() => _speakWebSpeech(text)).catch(() => {});
    return _queue;
  }

  // ── Monthly budget guard ──────────────────────────────────────────────────
  const usage = _getUsage();
  const stripped = _stripMarkdown(text);
  if (usage.chars + stripped.length > MONTHLY_BUDGET) {
    console.warn(
      `[TTS] Monthly budget reached (${usage.chars.toLocaleString()} / ${MONTHLY_BUDGET.toLocaleString()} chars). ` +
        "No more requests this month.",
    );
    return Promise.resolve();
  }

  _queue = _queue.then(() => _playOnce(text, stripped)).catch(() => {});
  return _queue;
}

/**
 * Immediately stop the current narration and discard the pending queue.
 * Subsequent speakNarration() calls will start fresh.
 */
export function stopNarration() {
  _generation++; // Invalidate any in-flight _playOnce
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio = null;
  }
  // Also cancel any in-progress Web Speech utterance
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  _queue = Promise.resolve(); // Drop queued items
  eventBus.emit(EVENTS.TTS_STOPPED, {});
}

/**
 * Toggle the DM-voice mute.
 * Stopping current audio when muting.
 * @returns {boolean}  New mute state.
 */
export function toggleTtsMute() {
  _muted = !_muted;
  if (_muted) stopNarration();
  eventBus.emit(EVENTS.TTS_MUTE_CHANGED, { muted: _muted });
  return _muted;
}

/** @returns {boolean} */
export function isTtsMuted() {
  return _muted;
}

/**
 * Returns the current-month GCP TTS character usage for the Settings UI.
 * Resets automatically when the calendar month rolls over.
 *
 * @returns {{ used: number, budget: number, month: string }}
 */
export function getMonthlyUsage() {
  const u = _getUsage();
  return { used: u.chars, budget: MONTHLY_BUDGET, month: u.month };
}

// ── Private ────────────────────────────────────────────────────────────────────

/**
 * Decide whether a DM narration line is worth speaking aloud.
 *
 * Speaks: combat events, discoveries, deaths, traps, magic, emotion, tension.
 * Skips:  pure movement descriptions, short filler, transitional sentences.
 *
 * @param {string} text
 * @returns {boolean}
 */
function _isSignificantNarration(text) {
  if (!text || text.trim().length < 30) return false;

  const t = text.toLowerCase();

  // Keywords that signal something worth narrating aloud
  const importantWords = [
    // Combat
    "attack",
    "strike",
    "hit",
    "wound",
    "damage",
    "slash",
    "stab",
    "swing",
    "crit",
    "kill",
    "dead",
    "die",
    "dies",
    "dying",
    "fallen",
    "defeat",
    "blood",
    "pain",
    "scream",
    "roar",
    "snarl",
    "howl",
    // High tension
    "danger",
    "trap",
    "ambush",
    "surprise",
    "flee",
    "escape",
    "chase",
    "dark",
    "shadow",
    "cursed",
    "evil",
    "ancient",
    "forbidden",
    // Discovery / story
    "discover",
    "reveal",
    "find",
    "secret",
    "hidden",
    "door",
    "chest",
    "magic",
    "spell",
    "ritual",
    "glow",
    "rune",
    "portal",
    "artifact",
    // NPC interaction
    "says",
    "shouts",
    "whispers",
    "warns",
    "pleads",
    "demands",
    // Dramatic
    "suddenly",
    "without warning",
    "before you can",
    "crumbles",
    "collapses",
  ];

  return importantWords.some((w) => t.includes(w));
}

// ── Usage tracking (localStorage) ─────────────────────────────────────────────

/** Returns the current-month usage record, resetting if the month has rolled over. */
function _getUsage() {
  const thisMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  try {
    const raw = localStorage.getItem(USAGE_LS_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (stored.month === thisMonth) return stored;
    }
  } catch {
    /* ignore parse errors */
  }
  return { month: thisMonth, chars: 0 };
}

/** Persist `charCount` additional characters into the usage record. */
function _addUsage(charCount) {
  const usage = _getUsage();
  usage.chars += charCount;
  try {
    localStorage.setItem(USAGE_LS_KEY, JSON.stringify(usage));
  } catch {
    // ignore storage errors (private browsing etc.)
  }
}

// ── Core playback ──────────────────────────────────────────────────────────────

/**
 * Web Speech API fallback — used when no GCP key is configured.
 * Picks the best available English (British preferred) voice.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
function _speakWebSpeech(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();

    // Cancel any current utterance
    window.speechSynthesis.cancel();

    const stripped = _stripMarkdown(text);
    const utter = new SpeechSynthesisUtterance(stripped);
    utter.lang = "en-GB";
    utter.rate = 0.88;
    utter.pitch = 0.85;
    utter.volume = NARRATION_VOLUME;

    // Pick best available voice: prefer en-GB, fall back to any en-*
    const voices = window.speechSynthesis.getVoices();
    const pick =
      voices.find((v) => v.lang === "en-GB" && v.localService === false) ??
      voices.find((v) => v.lang === "en-GB") ??
      voices.find((v) => v.lang.startsWith("en"));
    if (pick) utter.voice = pick;

    utter.onend = () => resolve();
    utter.onerror = () => resolve();

    eventBus.emit(EVENTS.TTS_SPEAK, { text: stripped.slice(0, 60) });
    window.speechSynthesis.speak(utter);
  });
}

/**
 * Call GCP TTS, decode the returned base64 MP3, and play it to completion.
 * Also records character usage in localStorage on success.
 *
 * @param {string} text      Raw narration (may have Markdown).
 * @param {string} [plain]   Pre-stripped plain text — avoids double-stripping.
 * @returns {Promise<void>}
 */
async function _playOnce(text, plain) {
  if (_muted || !_apiKey) return;

  const gen = _generation; // Snapshot so we can detect stopNarration()
  const stripped = plain ?? _stripMarkdown(text);
  const ssml = _buildSsml(stripped);

  console.log("[TTS] _playOnce() — calling GCP, chars:", stripped.length);

  // ── 1. Fetch audio from GCP TTS ─────────────────────────────────────────
  let audioContent;
  try {
    const res = await fetch(
      `${GCP_TTS_URL}?key=${encodeURIComponent(_apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { ssml },
          voice: {
            languageCode: LANG_CODE,
            name: VOICE_NAME,
            ssmlGender: "MALE",
          },
          audioConfig: {
            audioEncoding: "MP3",
            pitch: AUDIO_PITCH,
            speakingRate: AUDIO_SPEAKING_RATE,
          },
        }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => "(unreadable)");
      console.error(`[TTS] GCP error ${res.status}:`, errBody);
      // Fallback to Web Speech on GCP failure
      await _speakWebSpeech(text);
      return;
    }

    const data = await res.json();
    audioContent = data.audioContent; // base64-encoded MP3
    _addUsage(stripped.length);
  } catch (err) {
    console.warn("[TTS] Network error:", err.message);
    return;
  }

  if (gen !== _generation) return; // stopNarration() called during fetch

  // ── 2. Decode base64 → Blob URL ─────────────────────────────────────────
  let blobUrl;
  try {
    const binary = atob(audioContent);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    blobUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  } catch (err) {
    console.warn("[TTS] Decode error:", err.message);
    return;
  }

  // ── 3. Play via HTMLAudioElement ────────────────────────────────────────
  return new Promise((resolve) => {
    const audio = new Audio(blobUrl);
    audio.volume = NARRATION_VOLUME;
    _currentAudio = audio;

    const cleanup = () => {
      URL.revokeObjectURL(blobUrl);
      if (_currentAudio === audio) _currentAudio = null;
      resolve();
    };

    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    audio.play().catch((err) => {
      console.warn("[TTS] play() blocked:", err.message);
      cleanup();
    });

    eventBus.emit(EVENTS.TTS_SPEAK, { text: text.slice(0, 60) });
  });
}

/**
 * Build wizard-voice SSML from already-stripped plain text.
 *
 * @param {string} plain  Already Markdown-stripped text.
 * @returns {string}
 */
function _buildSsml(plain) {
  const escaped = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  // Dramatic pause after the first sentence (pitch/rate moved to audioConfig)
  const withBreak = escaped.replace(
    /([.!?])(\s+)/,
    `$1<break time="600ms"/>$2`,
  );

  return `<speak>${withBreak}</speak>`;
}

/**
 * Strip Markdown so the TTS engine hears clean prose.
 *
 * @param {string} text
 * @returns {string}
 */
function _stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1") // **bold**
    .replace(/\*(.+?)\*/gs, "$1") // *italic*
    .replace(/_(.+?)_/gs, "$1") // _italic_
    .replace(/~~(.+?)~~/gs, "$1") // ~~strikethrough~~
    .replace(/`(.+?)`/gs, "$1") // `code`
    .replace(/^#{1,6}\s+/gm, "") // ## Headings
    .replace(/^\s*[-*>]\s+/gm, "") // Bullets / blockquotes
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [link](url)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
