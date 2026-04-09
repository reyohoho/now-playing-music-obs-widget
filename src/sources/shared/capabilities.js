import { AUDIO_ACTIONS, TRANSPORT_ACTIONS } from "@/sources/shared/actions";

const TRANSPORT_ACTION_LIST = [
  TRANSPORT_ACTIONS.PLAY,
  TRANSPORT_ACTIONS.PAUSE,
  TRANSPORT_ACTIONS.TOGGLE,
  TRANSPORT_ACTIONS.NEXT,
  TRANSPORT_ACTIONS.PREVIOUS,
];

const AUDIO_ACTION_LIST = [
  AUDIO_ACTIONS.SEEK,
  AUDIO_ACTIONS.VOLUME,
  AUDIO_ACTIONS.MUTE,
  AUDIO_ACTIONS.UNMUTE,
  AUDIO_ACTIONS.MUTE_TOGGLE,
];

function mapActions(actions, value) {
  return Object.fromEntries(actions.map((action) => [action, value]));
}

export function buildControlActionMap({
  defaultTransport = false,
  defaultAudio = false,
  transportOverrides = {},
  audioOverrides = {},
} = {}) {
  return {
    ...mapActions(TRANSPORT_ACTION_LIST, defaultTransport),
    ...mapActions(AUDIO_ACTION_LIST, defaultAudio),
    ...transportOverrides,
    ...audioOverrides,
  };
}

