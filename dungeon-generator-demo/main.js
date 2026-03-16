import { LootSystem } from "./LootSystem.js";
import { InventorySystem } from "./InventorySystem.js";

const createEventBus = () => {
  const subscribers = {};
  return {
    on(eventType, callback) {
      if (!subscribers[eventType]) {
        subscribers[eventType] = [];
      }
      subscribers[eventType].push(callback);
    },
    emit(eventType, data) {
      if (subscribers[eventType]) {
        subscribers[eventType].forEach((callback) => callback(data));
      }
    },
  };
};

const createMockECS = () => {
  let nextEntityId = 0;
  const entities = new Map();

  return {
    createEntity() {
      const id = nextEntityId++;
      const entity = {
        id,
        components: new Map(),
        with(component) {
          this.components.set(component.type, component);
          return this;
        },
      };
      entities.set(id, entity);
      return entity;
    },
    destroyEntity(id) {
      entities.delete(id);
      console.log(`ECS: Entitás (ID: ${id}) törölve.`);
    },
    findEntities(componentType) {
      const results = [];
      for (const entity of entities.values()) {
        if (entity.components.has(componentType)) {
          results.push(entity);
        }
      }
      return results;
    },
  };
};

document.addEventListener("DOMContentLoaded", () => {
  const ecs = createMockECS();
  const eventBus = createEventBus();

  new LootSystem(ecs, eventBus);
  const inventorySystem = new InventorySystem(ecs);

  const player = ecs
    .createEntity()
    .with({ type: "Name", value: "Hős" })
    .with({ type: "Position", x: 5, y: 5 })
    .with({ type: "Renderable", char: "@", color: "white" })
    .with({ type: "Inventory", items: [], maxSize: 10 });

  const enemy = ecs
    .createEntity()
    .with({ type: "Name", value: "Goblin" })
    .with({ type: "Position", x: 7, y: 5 })
    .with({ type: "Renderable", char: "g", color: "green" });

  const output = document.getElementById("output");
  const log = (message) => {
    if (output) output.textContent += `${message}\n`;
    console.log(message);
  };

  log("--- Játék kezdete ---");
  inventorySystem.displayInventory(player, log);

  setTimeout(() => {
    const enemyName = enemy.components.get("Name")?.value ?? "Ellenség";
    log(`\n--- Harc vége: ${enemyName} meghalt! ---`);

    eventBus.emit("COMBAT_END", { deceased: enemy });
    ecs.destroyEntity(enemy.id);
  }, 1000);

  setTimeout(() => {
    log("\n--- Játékos mozog és felveszi a zsákmányt ---");
    const lootDrops = ecs.findEntities("LootDrop");

    if (lootDrops.length > 0) {
      const lootToPickup = lootDrops[0];
      const lootPosition = lootToPickup.components.get("Position");

      player.components.get("Position").x = lootPosition.x;
      player.components.get("Position").y = lootPosition.y;

      const pickedUp = inventorySystem.pickupItem(player, lootToPickup);
      if (!pickedUp) {
        log("A tárgy felvétele nem sikerült.");
      }

      inventorySystem.displayInventory(player, log);
    } else {
      log("Nem volt zsákmány, amit fel lehetett volna venni.");
    }
  }, 2000);
});
