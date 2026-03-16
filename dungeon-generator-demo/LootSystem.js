import { getRandomItem } from "./ItemDatabase.js";

export class LootSystem {
  /**
   * @param {object} ecs
   * @param {object} eventBus
   */
  constructor(ecs, eventBus) {
    this.ecs = ecs;
    this.eventBus = eventBus;

    this.eventBus.on("COMBAT_END", this.handleCombatEnd.bind(this));
  }

  /**
   * @param {object} eventData
   */
  handleCombatEnd(eventData) {
    const deceasedEntity = eventData?.deceased;
    if (!deceasedEntity || !deceasedEntity.components?.has("Position")) {
      return;
    }

    if (Math.random() < 0.5) {
      console.log("LootSystem: Nincs zsákmány ezúttal.");
      return;
    }

    const position = deceasedEntity.components.get("Position");
    const itemData = getRandomItem();

    console.log(
      `LootSystem: Zsákmány generálva (${itemData.name}) a(z) (${position.x},${position.y}) pozíción.`,
    );

    this.ecs
      .createEntity()
      .with({ type: "Position", x: position.x, y: position.y })
      .with({
        type: "Renderable",
        char: itemData.render.char,
        color: itemData.render.color,
      })
      .with({ type: "Item", ...itemData })
      .with({ type: "LootDrop" });
  }
}
