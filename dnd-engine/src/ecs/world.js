/**
 * Minimal Entity-Component storage.
 * Entities are opaque IDs; components are plain data objects keyed by type.
 */
export class ECSWorld {
  constructor() {
    this.entities = new Set();
    this.componentStores = new Map();
    this._nextEntityId = 1;
  }

  createEntity(forcedId = null) {
    const entityId = forcedId ?? `entity_${this._nextEntityId++}`;
    this.entities.add(entityId);
    return entityId;
  }

  ensureEntity(entityId) {
    if (!this.entities.has(entityId)) {
      this.entities.add(entityId);
    }
    return entityId;
  }

  removeEntity(entityId) {
    this.entities.delete(entityId);
    this.componentStores.forEach((store) => store.delete(entityId));
  }

  setComponent(entityId, componentType, componentData) {
    this.ensureEntity(entityId);

    if (!this.componentStores.has(componentType)) {
      this.componentStores.set(componentType, new Map());
    }

    this.componentStores.get(componentType).set(entityId, componentData);
    return componentData;
  }

  getComponent(entityId, componentType) {
    return this.componentStores.get(componentType)?.get(entityId) ?? null;
  }

  hasComponent(entityId, componentType) {
    return this.componentStores.get(componentType)?.has(entityId) ?? false;
  }

  removeComponent(entityId, componentType) {
    this.componentStores.get(componentType)?.delete(entityId);
  }

  updateComponent(entityId, componentType, updater) {
    const previous = this.getComponent(entityId, componentType);
    if (!previous) return null;

    const next = updater(previous);
    const resolved = next ?? previous;
    this.setComponent(entityId, componentType, resolved);
    return resolved;
  }

  getEntitiesWith(componentTypes = []) {
    if (!Array.isArray(componentTypes) || componentTypes.length === 0) {
      return [...this.entities];
    }

    const stores = componentTypes
      .map((type) => this.componentStores.get(type))
      .filter(Boolean);

    if (stores.length !== componentTypes.length) return [];

    const [seedStore, ...rest] = stores.sort((a, b) => a.size - b.size);
    const matching = [];

    for (const entityId of seedStore.keys()) {
      if (rest.every((store) => store.has(entityId))) {
        matching.push(entityId);
      }
    }

    return matching;
  }
}
