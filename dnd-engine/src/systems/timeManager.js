import { campaignManager } from "../engine/CampaignManager.js";

function _normaliseMeta(meta = {}) {
  return {
    source: String(meta.source ?? "time-manager").trim() || "time-manager",
    reason: String(meta.reason ?? "").trim(),
  };
}

export const timeManager = {
  advanceTime(minutes, meta = {}) {
    return campaignManager.advanceTime(minutes, _normaliseMeta(meta));
  },

  getCurrentTime() {
    return campaignManager.getWorldState().time;
  },

  getTimeOfDay(timeInput) {
    return campaignManager.getTimeOfDay(timeInput);
  },

  getCurrentTimeLabel() {
    return campaignManager.describeCurrentTime();
  },
};
