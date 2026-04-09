import { MSG } from "@/shared/messages";

export function runtimeMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false });
    });
  });
}

export function getSettings() {
  return runtimeMessage({ type: MSG.SETTINGS_GET });
}

export function setSettings(patch) {
  return runtimeMessage({ type: MSG.SETTINGS_SET, patch });
}

export function getPopupState() {
  return runtimeMessage({ type: MSG.POPUP_GET_STATE });
}

export function obsReconnect() {
  return runtimeMessage({ type: MSG.OBS_RECONNECT });
}

export function getObsStatus() {
  return runtimeMessage({ type: MSG.OBS_GET_STATUS });
}

export function twitchReconnect() {
  return runtimeMessage({ type: MSG.TWITCH_RECONNECT });
}

export function getTwitchStatus() {
  return runtimeMessage({ type: MSG.TWITCH_GET_STATUS });
}

export function startTwitchAuth() {
  return runtimeMessage({ type: MSG.TWITCH_AUTH_START });
}
