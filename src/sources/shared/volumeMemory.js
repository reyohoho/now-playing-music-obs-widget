import { clamp01 } from "@/sources/shared/number";
import {
  readPercentFromLocalStorage,
  writePercentToLocalStorage,
} from "@/sources/shared/storage";

export function createVolumeMemory({
  volumeKey,
  lastNonZeroKey,
  minAudible = 0.001,
  defaultResume = 0.5,
}) {
  const readVolume = (context) => readPercentFromLocalStorage(context, volumeKey);

  const persistVolume = (context, ratio) =>
    writePercentToLocalStorage(context, volumeKey, ratio);

  const persistLastNonZero = (context, ratio) => {
    const normalized = clamp01(ratio);
    if (!Number.isFinite(normalized) || normalized <= minAudible) return false;
    return writePercentToLocalStorage(context, lastNonZeroKey, normalized);
  };

  const readLastNonZero = (context) => {
    const value = readPercentFromLocalStorage(context, lastNonZeroKey);
    if (!Number.isFinite(value) || value <= minAudible) return Number.NaN;
    return value;
  };

  const resolveResumeRatio = (context) => {
    const lastNonZero = readLastNonZero(context);
    if (Number.isFinite(lastNonZero)) return lastNonZero;

    const fallback = readVolume(context);
    if (Number.isFinite(fallback) && fallback > minAudible) return fallback;
    return defaultResume;
  };

  const persistState = (context, ratio) => {
    persistVolume(context, ratio);
    if (ratio > minAudible) persistLastNonZero(context, ratio);
  };

  return Object.freeze({
    readVolume,
    persistVolume,
    readLastNonZero,
    persistLastNonZero,
    resolveResumeRatio,
    persistState,
  });
}

