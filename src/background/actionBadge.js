const BADGE_TEXT = "•";
const BADGE_TEXT_COLOR = "#ffffff";

const BADGE_COLORS = Object.freeze({
  success: "#16a34a",
  warning: "#f59e0b",
  error: "#dc2626",
});

function isObsActive(settings) {
  return settings?.obs?.enabled === true;
}

function isTwitchActive(settings) {
  if (settings?.twitch?.enabled !== true) return false;
  return settings?.twitch?.controlEnabled === true || settings?.twitch?.announceEnabled === true;
}

function isConnected(status) {
  return String(status?.state || "").trim().toLowerCase() === "connected";
}

export function resolveActionBadgeState({ settings, obsStatus, twitchStatus, activeSnapshot }) {
  const obsActive = isObsActive(settings);
  const twitchActive = isTwitchActive(settings);
  const anyActiveIntegration = obsActive || twitchActive;

  if (!anyActiveIntegration) {
    return {
      visible: false,
      color: "",
      text: "",
      reason: "inactive",
    };
  }

  const obsBroken = obsActive && !isConnected(obsStatus);
  const twitchBroken = twitchActive && !isConnected(twitchStatus);
  if (obsBroken || twitchBroken) {
    return {
      visible: true,
      color: BADGE_COLORS.error,
      text: BADGE_TEXT,
      reason: "integration_error",
    };
  }

  if (!activeSnapshot) {
    return {
      visible: true,
      color: BADGE_COLORS.warning,
      text: BADGE_TEXT,
      reason: "no_primary_source",
    };
  }

  return {
    visible: true,
    color: BADGE_COLORS.success,
    text: BADGE_TEXT,
    reason: "ok",
  };
}

export async function syncExtensionActionBadge({
  actionApi,
  settings,
  obsStatus,
  twitchStatus,
  activeSnapshot,
}) {
  if (!actionApi?.setBadgeText || !actionApi?.setBadgeBackgroundColor) return;

  const badgeState = resolveActionBadgeState({
    settings,
    obsStatus,
    twitchStatus,
    activeSnapshot,
  });

  if (!badgeState.visible) {
    await actionApi.setBadgeText({ text: "" });
    return;
  }

  await actionApi.setBadgeText({ text: badgeState.text });
  await actionApi.setBadgeBackgroundColor({ color: badgeState.color });
  if (typeof actionApi.setBadgeTextColor === "function") {
    await actionApi.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
  }
}

