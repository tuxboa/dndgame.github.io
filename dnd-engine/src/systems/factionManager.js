import { campaignManager } from "../engine/CampaignManager.js";

function _toDelta(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(numeric);
}

function _normaliseMeta(meta = {}) {
  return {
    source: String(meta.source ?? "faction-manager").trim() || "faction-manager",
    reason: String(meta.reason ?? "").trim(),
  };
}

function _applyFactionDelta(faction, delta, meta = {}) {
  return campaignManager.updateFactionReputation(
    faction,
    _toDelta(delta, 0),
    _normaliseMeta(meta),
  );
}

export const factionManager = {
  increaseFaction(faction, amount = 1, meta = {}) {
    const delta = Math.abs(_toDelta(amount, 1));
    return _applyFactionDelta(faction, delta, meta);
  },

  decreaseFaction(faction, amount = 1, meta = {}) {
    const delta = -Math.abs(_toDelta(amount, 1));
    return _applyFactionDelta(faction, delta, meta);
  },

  applyFactionUpdates(updates = [], meta = {}) {
    return campaignManager.applyFactionUpdates(updates, _normaliseMeta(meta));
  },

  registerGuardKill(meta = {}) {
    return campaignManager.applyFactionUpdates(
      [
        { faction: "City_Guard", delta: -25 },
        { faction: "Underworld", delta: +10 },
      ],
      _normaliseMeta({
        ...meta,
        reason: String(meta.reason ?? "guard-killed").trim() || "guard-killed",
      }),
    );
  },

  getFactions() {
    return campaignManager.getWorldState().factions ?? {};
  },
};
