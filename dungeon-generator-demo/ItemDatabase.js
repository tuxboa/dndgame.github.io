export const items = new Map([
  [
    "gold_small",
    {
      id: "gold_small",
      name: "Kis adag arany",
      type: "CURRENCY",
      render: { char: "$", color: "gold" },
    },
  ],
  [
    "health_potion",
    {
      id: "health_potion",
      name: "Életerő ital",
      type: "CONSUMABLE",
      render: { char: "!", color: "red" },
    },
  ],
  [
    "sword_1",
    {
      id: "sword_1",
      name: "Rozsdás kard",
      type: "WEAPON",
      render: { char: "/", color: "silver" },
    },
  ],
]);

/**
 * Visszaad egy véletlenszerű tárgyat az adatbázisból.
 * @returns {object}
 */
export function getRandomItem() {
  const allItems = Array.from(items.values());
  const randomIndex = Math.floor(Math.random() * allItems.length);
  return allItems[randomIndex];
}
