/**
 * apiConfig.js — Centralized API key management.
 *
 * Keys are stored in localStorage so they persist across sessions and page
 * refreshes. No keys are ever baked into the source code or .env files.
 *
 * The user enters keys via the in-game ⚙️ Settings modal.
 * If no key is found the app runs in offline / fallback mode.
 *
 * Storage keys:
 *   "dnd_dm_key"  — Groq API key  (DM AI / combat AI)
 *   "dnd_tts_key" — GCP TTS key   (DM Voice narration)
 */

const LS_GROQ_KEY = "dnd_dm_key";
const LS_TTS_KEY = "dnd_tts_key";

// ── Readers ───────────────────────────────────────────────────────────────────

/** Returns the stored Groq API key, or "" if not set. */
export function getGroqKey() {
  return localStorage.getItem(LS_GROQ_KEY) ?? "";
}

/** Returns the stored GCP TTS API key, or "" if not set. */
export function getTtsKey() {
  return localStorage.getItem(LS_TTS_KEY) ?? "";
}

// ── Writers ───────────────────────────────────────────────────────────────────

/**
 * Persist the Groq key to localStorage.
 * Passing an empty string removes the key (switches to offline mode).
 * @param {string} key
 */
export function saveGroqKey(key) {
  const trimmed = (key ?? "").trim();
  if (trimmed) {
    localStorage.setItem(LS_GROQ_KEY, trimmed);
  } else {
    localStorage.removeItem(LS_GROQ_KEY);
  }
}

/**
 * Persist the GCP TTS key to localStorage.
 * Passing an empty string disables TTS.
 * @param {string} key
 */
export function saveTtsKey(key) {
  const trimmed = (key ?? "").trim();
  if (trimmed) {
    localStorage.setItem(LS_TTS_KEY, trimmed);
  } else {
    localStorage.removeItem(LS_TTS_KEY);
  }
}

// ── Status helpers ────────────────────────────────────────────────────────────

/** True if a Groq key is configured (AI DM is enabled). */
export function isAiEnabled() {
  return !!getGroqKey();
}

/** True if a GCP TTS key is configured (DM Voice is enabled). */
export function isTtsEnabled() {
  return !!getTtsKey();
}
