export class SourceRegistry {
  constructor() {
    this.instances = new Map();
  }

  static normalizeFrameId(frameId) {
    return Number.isInteger(frameId) && frameId >= 0 ? frameId : null;
  }

  static key(tabId, sourceId, frameId = null) {
    const normalizedFrameId = SourceRegistry.normalizeFrameId(frameId);
    if (normalizedFrameId == null) return `${tabId}:${sourceId}`;
    return `${tabId}:${normalizedFrameId}:${sourceId}`;
  }

  upsert(instance) {
    const frameId = SourceRegistry.normalizeFrameId(instance.frameId);
    const key = SourceRegistry.key(instance.tabId, instance.snapshot.sourceId, frameId);
    this.instances.set(key, {
      key,
      tabId: instance.tabId,
      frameId: frameId ?? 0,
      tabTitle: instance.tabTitle || "",
      url: instance.url || "",
      snapshot: instance.snapshot,
    });
    return key;
  }

  remove(tabId, sourceId, frameId = null) {
    const normalizedFrameId = SourceRegistry.normalizeFrameId(frameId);
    if (normalizedFrameId != null) {
      return this.instances.delete(SourceRegistry.key(tabId, sourceId, normalizedFrameId));
    }

    const legacyKey = SourceRegistry.key(tabId, sourceId);
    if (this.instances.delete(legacyKey)) return true;

    const prefix = `${tabId}:`;
    let removed = false;
    for (const key of [...this.instances.keys()]) {
      if (!key.startsWith(prefix)) continue;
      if (!key.endsWith(`:${sourceId}`)) continue;
      this.instances.delete(key);
      removed = true;
    }
    return removed;
  }

  removeKey(key) {
    return this.instances.delete(key);
  }

  get(key) {
    return this.instances.get(key) ?? null;
  }

  removeTab(tabId) {
    const prefix = `${tabId}:`;
    for (const key of this.instances.keys()) {
      if (key.startsWith(prefix)) this.instances.delete(key);
    }
  }

  clear() {
    this.instances.clear();
  }

  values() {
    return [...this.instances.values()];
  }
}
