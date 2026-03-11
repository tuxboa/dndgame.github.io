/**
 * InventoryPanel.js
 *
 * Slide-in inventory panel:
 *   - List of items with quantity, equipped state, value
 *   - Equip/unequip toggle
 *   - Use (consumables)
 *   - Drop (remove 1)
 *   - Gold display
 *   - Trade proposal UI (offer items → NPC accepts/rejects)
 *
 * Subscribes to store inventory slice — auto-updates when items change.
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";
import { removeItem } from "../../systems/inventorySystem.js";
import { useItem } from "../../engine/actionDispatcher.js";
import {
  equipItem,
  unequipItem,
  isEquippable,
} from "../../systems/equipmentSystem.js";
import { EQUIPMENT_SLOTS } from "../../data/equipment.js";

let _isOpen = false;

// ── Confirm Drop popup ────────────────────────────────────────────────────────
/**
 * Shows a small centered confirmation popup.
 * Returns a Promise<boolean> — true if user confirmed, false if cancelled.
 */
function _confirmDrop(itemName) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay drop-confirm-overlay";
    overlay.innerHTML = `
      <div class="modal drop-confirm-modal">
        <h2>⚠️ Item eldobása</h2>
        <p>Biztosan eldobod: <strong>${itemName}</strong>?</p>
        <p class="drop-confirm-warning">Ez a művelet nem vonható vissza — az item véglegesen elvész!</p>
        <div class="drop-confirm-actions">
          <button class="btn-drop-yes">Igen, eldobom</button>
          <button class="btn-drop-no">Mégsem</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay
      .querySelector(".btn-drop-yes")
      .addEventListener("click", () => cleanup(true));
    overlay
      .querySelector(".btn-drop-no")
      .addEventListener("click", () => cleanup(false));
    // Click outside modal also cancels
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initInventoryUI() {
  // Create the panel element once
  const panel = document.createElement("aside");
  panel.id = "inventory-panel";
  panel.innerHTML = `
    <div class="inv-header">
      <h2 class="inv-title">Inventory</h2>
      <button id="btn-close-inv" class="inv-close" title="Close">✕</button>
    </div>
    <div class="inv-gold" id="inv-gold"></div>
    <div class="inv-list" id="inv-list"></div>

    <!-- Trade panel — shown when trade is active -->
    <div class="trade-panel hidden" id="trade-panel">
      <h3 class="trade-title" id="trade-title">Trade</h3>
      <div class="trade-cols">
        <div class="trade-col">
          <p class="trade-col-label">You offer</p>
          <div id="trade-offer-list" class="trade-list"></div>
        </div>
        <div class="trade-col">
          <p class="trade-col-label">You receive</p>
          <div id="trade-receive-list" class="trade-list"></div>
        </div>
      </div>
      <div class="trade-actions">
        <button id="btn-trade-accept" class="btn-primary">Accept</button>
        <button id="btn-trade-cancel" class="btn-secondary">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Close button
  document
    .getElementById("btn-close-inv")
    .addEventListener("click", closeInventory);

  // Trade buttons (delegated — panel always exists)
  document
    .getElementById("btn-trade-accept")
    ?.addEventListener("click", async () => {
      const { acceptTrade } = await import("../../systems/inventorySystem.js");
      acceptTrade();
      renderTradePanel(gameStore.getState().trade);
    });
  document
    .getElementById("btn-trade-cancel")
    ?.addEventListener("click", async () => {
      const { cancelTrade } = await import("../../systems/inventorySystem.js");
      cancelTrade();
      renderTradePanel(gameStore.getState().trade);
    });

  // Subscribe to inventory changes
  gameStore.subscribe((state) => {
    if (_isOpen) {
      renderInventoryList(state.player.inventory);
      renderGold(state.player.gold);
      renderTradePanel(state.trade);
    }
  });

  // Show/hide via trade event
  eventBus.on(EVENTS.TRADE_PROPOSED, () => openInventory());
}

export function openInventory() {
  _isOpen = true;
  const panel = document.querySelector("#inventory-panel");
  panel?.classList.add("open");

  const state = gameStore.getState();
  renderInventoryList(state.player.inventory);
  renderGold(state.player.gold);
  renderTradePanel(state.trade);
}

export function closeInventory() {
  _isOpen = false;
  document.querySelector("#inventory-panel")?.classList.remove("open");
}

export function toggleInventory() {
  _isOpen ? closeInventory() : openInventory();
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderGold(gold) {
  const el = document.getElementById("inv-gold");
  if (el) el.textContent = `🪙 ${gold} gold pieces`;
}

function renderInventoryList(inventory) {
  const list = document.getElementById("inv-list");
  if (!list) return;

  if (!inventory.length) {
    list.innerHTML = `<p class="inv-empty">Your pack is empty.</p>`;
    return;
  }

  const equippedIds = new Set(
    inventory.filter((i) => i.equipped).map((i) => i.itemId),
  );

  list.innerHTML = inventory
    .map((item) => {
      const template =
        isEquippable(item.itemId) ||
        isEquippable(
          (item.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        );
      const isEquipped = equippedIds.has(item.itemId);
      const slotMeta = template ? EQUIPMENT_SLOTS[template.slot] : null;
      const idLower = (item.itemId ?? "").toLowerCase();
      const nameLower = (item.name ?? "").toLowerCase();
      const isConsumable =
        !template &&
        (idLower.includes("potion") ||
          idLower.includes("scroll") ||
          idLower.includes("elixir") ||
          idLower.includes("ale") ||
          idLower.includes("brew") ||
          idLower.includes("drink") ||
          nameLower.includes("potion") ||
          nameLower.includes("elixir") ||
          nameLower.includes("ale") ||
          nameLower.includes("brew"));

      const badge = slotMeta
        ? `<span class="inv-slot-badge inv-slot-badge--${template.slot}">${slotMeta.icon} ${slotMeta.label}</span>`
        : "";

      const equipBtn = template
        ? `<button class="inv-btn ${isEquipped ? "inv-btn--unequip" : "inv-btn--equip"}" data-id="${item.itemId}">
             ${isEquipped ? "Unequip" : "Equip"}
           </button>`
        : "";

      const useBtn = isConsumable
        ? `<button class="inv-btn inv-btn--use" data-id="${item.itemId}">Use</button>`
        : "";

      // Stat preview line for equipped items
      const bonusLine =
        isEquipped && template
          ? `<span class="inv-item-bonus">${template.description}</span>`
          : "";

      return `
      <div class="inv-item ${isEquipped ? "inv-item--equipped" : ""}" data-item-id="${item.itemId}">
        <div class="inv-item-info">
          <span class="inv-item-name">${template?.icon ?? ""} ${item.name}</span>
          ${badge}
          ${item.quantity > 1 ? `<span class="inv-item-qty">×${item.quantity}</span>` : ""}
          ${item.description && !template ? `<span class="inv-item-desc">${item.description}</span>` : ""}
          ${bonusLine}
        </div>
        <div class="inv-item-actions">
          ${equipBtn}
          ${useBtn}
          <button class="inv-btn inv-btn--drop" data-id="${item.itemId}">Drop</button>
        </div>
      </div>
    `;
    })
    .join("");

  // Wire buttons using new equipment system
  list.querySelectorAll(".inv-btn--equip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const result = equipItem(btn.dataset.id);
      if (!result.ok)
        console.warn("[InventoryPanel] Equip failed:", result.reason);
    });
  });
  list.querySelectorAll(".inv-btn--unequip").forEach((btn) => {
    btn.addEventListener("click", () => unequipItem(btn.dataset.id));
  });
  list.querySelectorAll(".inv-btn--use").forEach((btn) => {
    btn.addEventListener("click", () => useItem(btn.dataset.id));
  });
  list.querySelectorAll(".inv-btn--drop").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = gameStore
        .getState()
        .player.inventory.find((i) => i.itemId === btn.dataset.id);
      const name = item?.name ?? btn.dataset.id;
      const confirmed = await _confirmDrop(name);
      if (!confirmed) return;
      removeItem(btn.dataset.id, 1);
    });
  });
}

function renderTradePanel(trade) {
  const panel = document.getElementById("trade-panel");
  if (!panel) return;

  if (!trade.active) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  document.getElementById("trade-title").textContent =
    `Trade with ${trade.counterpartyName}`;

  const renderItems = (items) =>
    items.length
      ? items
          .map((i) => `<div class="trade-item">${i.name} ×${i.quantity}</div>`)
          .join("")
      : `<p class="trade-empty">Nothing</p>`;

  document.getElementById("trade-offer-list").innerHTML = renderItems(
    trade.offeredItems,
  );
  document.getElementById("trade-receive-list").innerHTML = renderItems(
    trade.requestedItems,
  );
}
