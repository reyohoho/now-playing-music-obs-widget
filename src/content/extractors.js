import { getSourceModuleById } from "@/sources/index";
import {
  inferYandexPlaybackStateFromActionLabel,
  inferYandexTimesFromText,
} from "@/sources/providers/yandex-music/module";

export { inferYandexPlaybackStateFromActionLabel, inferYandexTimesFromText };

export function extractTrack(sourceId, context = {}) {
  const sourceModule = getSourceModuleById(sourceId);
  if (!sourceModule || typeof sourceModule.extract !== "function") return null;

  try {
    return sourceModule.extract(context);
  } catch (_) {
    return null;
  }
}
