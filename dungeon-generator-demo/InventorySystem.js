export class InventorySystem {
  /**
   * @param {object} ecs
   */
  constructor(ecs) {
    this.ecs = ecs;
  }

  /**
   * @param {object} actor
   * @param {object} itemEntity
   * @returns {boolean}
   */
  pickupItem(actor, itemEntity) {
    if (
      !actor?.components?.has("Inventory") ||
      !itemEntity?.components?.has("Item")
    ) {
      console.error(
        "InventorySystem: A felvételhez szükséges komponensek hiányoznak.",
      );
      return false;
    }

    const inventory = actor.components.get("Inventory");
    const item = itemEntity.components.get("Item");

    if (inventory.items.length >= inventory.maxSize) {
      const actorName = actor.components.get("Name")?.value ?? "Ismeretlen";
      console.log(`InventorySystem: A leltár (${actorName}) tele van!`);
      return false;
    }

    inventory.items.push(item);
    const actorName = actor.components.get("Name")?.value ?? "Ismeretlen";
    console.log(`InventorySystem: ${actorName} felvette: ${item.name}.`);

    this.ecs.destroyEntity(itemEntity.id);
    return true;
  }

  /**
   * @param {object} actor
   * @param {(msg:string)=>void} [logger]
   */
  displayInventory(actor, logger = console.log) {
    if (!actor?.components?.has("Inventory")) return;

    const inventory = actor.components.get("Inventory");
    const name = actor.components.get("Name")?.value ?? "Ismeretlen";

    logger(
      `--- ${name} leltára (${inventory.items.length}/${inventory.maxSize}) ---`,
    );
    if (inventory.items.length === 0) {
      logger("(üres)");
    } else {
      inventory.items.forEach((item) =>
        logger(`- ${item.name} (${item.type})`),
      );
    }
    logger("--------------------");
  }
}
