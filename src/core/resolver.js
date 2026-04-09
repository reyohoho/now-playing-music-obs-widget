import {
  findMatchingWrapperRule,
  getWrapperControlSelector,
  isBuiltInWrapperRule,
  makeWrapperSourceId,
  normalizeWrapperRules,
  WRAPPER_CONTROL_ACTIONS,
} from "@/shared/wrapperRules";
import { normalizeSourceMinDurationSec } from "@/shared/webMediaSettings";

function orderRank(sourceId, sourceOrder) {
  const idx = sourceOrder.indexOf(sourceId);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function playbackRank(playbackState) {
  if (playbackState === "playing") return 0;
  if (playbackState === "paused") return 1;
  if (playbackState === "ended") return 2;
  return Number.MAX_SAFE_INTEGER;
}

function snapshotUpdatedAt(instance) {
  return Number(instance?.snapshot?.updatedAt) || 0;
}

function safeWrapperRules(settings) {
  return normalizeWrapperRules(settings?.wrapperRules || []);
}

function baseSource(instance) {
  const sourceId = String(instance?.snapshot?.sourceId || "").trim();
  const sourceLabel = String(instance?.snapshot?.sourceLabel || sourceId || "").trim() || sourceId;
  return { sourceId, sourceLabel };
}

export function findWrapperMatchForInstance(instance, settings) {
  const { sourceId } = baseSource(instance);
  if (!sourceId) return null;
  return findMatchingWrapperRule({
    sourceId,
    url: instance?.url || "",
    wrapperRules: safeWrapperRules(settings),
  });
}

export function presentationSource(instance, settings) {
  const { sourceId, sourceLabel } = baseSource(instance);
  if (!sourceId) return null;

  const match = findWrapperMatchForInstance(instance, settings);
  if (!match) {
    return {
      id: sourceId,
      label: sourceLabel,
      wrapperMatch: null,
    };
  }

  if (isBuiltInWrapperRule(match.rule)) {
    return {
      id: sourceId,
      label: sourceLabel,
      wrapperMatch: match,
    };
  }

  const wrapperId = makeWrapperSourceId(match.rule.id);
  return {
    id: wrapperId || sourceId,
    label: String(match.rule.label || sourceLabel || sourceId),
    wrapperMatch: match,
  };
}

function toPresentationEntries(instances, settings, enabledMap) {
  return instances
    .map((instance) => ({
      instance,
      source: presentationSource(instance, settings),
    }))
    .filter(({ source }) => Boolean(source?.id))
    .filter(({ source }) => enabledMap[source.id] !== false)
    .filter(({ instance, source }) => !isFilteredBySourceMinDuration(instance, source, settings));
}

function isFilteredBySourceMinDuration(instance, source, settings) {
  const sourceId = String(source?.id || "").trim().toLowerCase();
  if (!sourceId) return false;

  const map =
    settings?.sourceMinDurationSecMap && typeof settings.sourceMinDurationSecMap === "object"
      ? settings.sourceMinDurationSecMap
      : {};
  const thresholdSec = normalizeSourceMinDurationSec(map[sourceId], 0);
  if (thresholdSec <= 0) return false;

  const isLive = Boolean(instance?.snapshot?.isLive);
  if (isLive) return false;

  const durationSec = Number(instance?.snapshot?.durationSec);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false;
  return durationSec < thresholdSec;
}

function mergeControlCapabilitiesWithWrapperSelectors(snapshot, wrapperMatch) {
  const base =
    snapshot?.controlCapabilities && typeof snapshot.controlCapabilities === "object"
      ? { ...snapshot.controlCapabilities }
      : {};
  const rule = wrapperMatch?.rule;
  if (!rule) return base;

  for (const action of WRAPPER_CONTROL_ACTIONS) {
    if (!getWrapperControlSelector(rule, action)) continue;
    base[action] = true;
  }
  return base;
}

export function buildActiveSessions(instances, settings) {
  const enabledMap = settings.sourceEnabledMap || {};
  const order = settings.sourceOrder || [];

  return toPresentationEntries([...instances], settings, enabledMap)
    .filter(({ instance }) => playbackRank(instance?.snapshot?.playbackState) < Number.MAX_SAFE_INTEGER)
    .sort((a, b) => {
      const byOrder = orderRank(a.source.id, order) - orderRank(b.source.id, order);
      if (byOrder !== 0) return byOrder;
      return String(a.instance.key).localeCompare(String(b.instance.key));
    })
    .map(({ instance, source }) => ({
      sessionId: instance.key,
      tabId: instance.tabId,
      frameId: Number.isInteger(instance.frameId) ? instance.frameId : 0,
      tabTitle: instance.tabTitle || "",
      url: instance.url || "",
      ...instance.snapshot,
      baseSourceId: String(instance?.snapshot?.sourceId || "").trim().toLowerCase(),
      controlCapabilities: mergeControlCapabilitiesWithWrapperSelectors(
        instance.snapshot,
        source.wrapperMatch
      ),
      sourceId: source.id,
      sourceLabel: source.label,
    }));
}

export function resolveActiveSource(instances, settings) {
  const enabledMap = settings.sourceEnabledMap || {};
  const order = settings.sourceOrder || [];

  const candidates = toPresentationEntries([...instances], settings, enabledMap).filter(
    ({ instance }) => playbackRank(instance?.snapshot?.playbackState) < Number.MAX_SAFE_INTEGER
  );

  candidates.sort((a, b) => {
    const byPlayback =
      playbackRank(a.instance.snapshot.playbackState) - playbackRank(b.instance.snapshot.playbackState);
    if (byPlayback !== 0) return byPlayback;

    const byOrder = orderRank(a.source.id, order) - orderRank(b.source.id, order);
    if (byOrder !== 0) return byOrder;
    return snapshotUpdatedAt(b.instance) - snapshotUpdatedAt(a.instance);
  });

  return candidates[0]?.instance ?? null;
}

export function buildProviderRows(instances, providers, settings) {
  const order = settings.sourceOrder || [];
  const enabledMap = settings.sourceEnabledMap || {};
  const bulkMuteIgnoreMap = settings.sourceBulkMuteIgnoreMap || {};
  const byProvider = new Map();

  for (const instance of instances) {
    const source = presentationSource(instance, settings);
    if (!source?.id) continue;
    const prev = byProvider.get(source.id);
    if (!prev || snapshotUpdatedAt(instance) > snapshotUpdatedAt(prev.instance)) {
      byProvider.set(source.id, {
        instance,
        source,
      });
    }
  }

  const knownProviderIds = new Set(providers.map((provider) => provider.id));
  const extraProviders = [...byProvider.entries()]
    .filter(([id]) => !knownProviderIds.has(id))
    .map(([id, value]) => ({
      id,
      label: String(value?.source?.label || id),
    }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));

  return [...providers]
    .sort((a, b) => orderRank(a.id, order) - orderRank(b.id, order))
    .concat(extraProviders)
    .map((provider) => {
      const latest = byProvider.get(provider.id);
      const snapshot = latest?.instance?.snapshot;
      return {
        id: provider.id,
        label: provider.label,
        enabled: enabledMap[provider.id] !== false,
        ignoreBulkMute: bulkMuteIgnoreMap[provider.id] === true,
        isActive: Boolean(snapshot),
        playbackState: snapshot?.playbackState || "idle",
        isPlaying: Boolean(snapshot?.isPlaying),
        title: snapshot?.title || "",
        artist: snapshot?.artist || "",
        updatedAt: snapshot?.updatedAt || 0,
      };
    });
}
