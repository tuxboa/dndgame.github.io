/**
 * MerchantUI.js
 *
 * Shop modal overlay.
 *
 * Flow:
 *   storyManager emits EVENTS.OPEN_SHOP { merchantName, items }
 *      ↓
 *   initMerchantUI() listener fires → _openShop()
 *      ↓
 *   Player uses Buy / Sell tabs → modifyGold + addItem / removeItem
 *      ↓
 *   "Leave Shop" or backdrop click → _closeShop()
 *
 * Shop item shape (for the Buy list):
 *   { itemId: string, name?: string, price: number, description?: string,
 *     icon?: string, value?: number, healDice?: string }
 */

import { gameStore } from "../../store/index.js";
import { eventBus, EVENTS } from "../../engine/eventBus.js";
import {
  addItem,
  removeItem,
  modifyGold,
} from "../../systems/inventorySystem.js";
import { isEquippable } from "../../systems/equipmentSystem.js";
import { EQUIPMENT_SLOTS } from "../../data/equipment.js";
import { playSFX } from "../../systems/audioSystem.js";

// ── Module state ──────────────────────────────────────────────────────────────

let _unsub = null; // store subscription — cleaned up on close
let _shop = null; // { merchantName, items }
let _tab = "buy"; // "buy" | "sell"

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Wire the shop modal into the DOM and start listening for OPEN_SHOP events.
 * Call exactly once during bootstrap.
 */
export function initMerchantUI() {
  _mountDOM();

  eventBus.on(EVENTS.OPEN_SHOP, ({ merchantName, items }) => {
    _shop = { merchantName, items: items ?? [] };
    _tab = "buy";
    _openShop();
  });
}

// ── DOM setup ─────────────────────────────────────────────────────────────────

function _mountDOM() {
  const overlay = document.createElement("div");
  overlay.id = "merchant-overlay";
  overlay.className = "merchant-overlay";
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("role", "dialog");
  overlay.innerHTML = `
    <div class="merchant-card">

      <div class="merchant-header">
        <div class="merchant-header-left">
          <span class="merchant-icon" id="merchant-icon">🏪</span>
          <div>
            <h2 class="merchant-name" id="merchant-name"></h2>
            <p class="merchant-gold" id="merchant-gold"></p>
          </div>
        </div>
        <button class="merchant-close" id="merchant-close" title="Leave shop">✕</button>
      </div>

      <div class="merchant-tabs" role="tablist">
        <button class="merchant-tab merchant-tab--active" data-tab="buy" role="tab">
          🛒 Buy
        </button>
        <button class="merchant-tab" data-tab="sell" role="tab">
          💰 Sell
        </button>
      </div>

      <div class="merchant-body" id="merchant-body"></div>

      <div class="merchant-footer">
        <button class="merchant-leave-btn" id="merchant-leave">Leave Shop</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) _closeShop();
  });

  document
    .getElementById("merchant-close")
    .addEventListener("click", _closeShop);
  document
    .getElementById("merchant-leave")
    .addEventListener("click", _closeShop);

  // Tab switching
  overlay.querySelectorAll(".merchant-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      _tab = tab.dataset.tab;
      overlay
        .querySelectorAll(".merchant-tab")
        .forEach((t) =>
          t.classList.toggle("merchant-tab--active", t.dataset.tab === _tab),
        );
      _renderBody();
    });
  });
}

// ── NPC relationship helpers ───────────────────────────────────────────────────

/**
 * Returns a price multiplier based on the merchant's relationship with the player.
 * friendly → 0.80 (20% discount), neutral → 1.0, hostile → 1.20 (20% surcharge)
 */
function _getPriceMultiplier() {
  const state = gameStore.getState();
  const merchantKey = _shop?.merchantName ?? "";
  const rel = state.world.npcRelationships?.[merchantKey];
  if (!rel) return 1.0;
  if (rel.disposition === "friendly") return 0.8;
  if (rel.disposition === "hostile") return 1.2;
  return 1.0;
}

/**
 * Adjust a base price according to the active NPC relationship.
 * Always returns at least 1 gold.
 */
function _adjustedPrice(basePrice) {
  return Math.max(1, Math.round(basePrice * _getPriceMultiplier()));
}

function _openShop() {
  const overlay = document.getElementById("merchant-overlay");

  // Reset tab indicator
  overlay
    .querySelectorAll(".merchant-tab")
    .forEach((t) =>
      t.classList.toggle("merchant-tab--active", t.dataset.tab === "buy"),
    );

  // Set merchant name & icon
  document.getElementById("merchant-name").textContent =
    _shop.merchantName ?? "Merchant";

  // Determine icon from first equippable item's slot, or fallback
  const firstTemplate = _shop.items
    .map((i) => isEquippable(i.itemId))
    .find(Boolean);
  const shopIcon =
    firstTemplate?.slot === "weapon"
      ? "⚔️"
      : firstTemplate?.slot === "armor"
        ? "🛡️"
        : "🏪";
  document.getElementById("merchant-icon").textContent = shopIcon;

  // Show overlay
  overlay.classList.add("merchant-overlay--visible");

  // Render once, then subscribe for reactive gold/inventory updates
  _render();
  _unsub = gameStore.subscribe(() => _render());
}

function _closeShop() {
  const overlay = document.getElementById("merchant-overlay");
  overlay.classList.remove("merchant-overlay--visible");
  _unsub?.();
  _unsub = null;
  _shop = null;
  eventBus.emit(EVENTS.SHOP_CLOSED, {});
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _render() {
  const { gold } = gameStore.getState().player;
  const goldEl = document.getElementById("merchant-gold");
  if (goldEl) goldEl.textContent = `🪙 ${gold} gp`;
  _renderBody();
}

function _renderBody() {
  const body = document.getElementById("merchant-body");
  if (!body || !_shop) return;

  body.innerHTML = _tab === "buy" ? _htmlBuy() : _htmlSell();
  _wireButtons();
}

// ── Buy tab ───────────────────────────────────────────────────────────────────

function _htmlBuy() {
  const { gold } = gameStore.getState().player;
  if (!_shop.items.length) {
    return `<p class="merchant-empty">This merchant has nothing for sale right now.</p>`;
  }

  const mult = _getPriceMultiplier();
  const discountBadge = mult < 1
    ? `<span class="merch-relation-badge merch-relation-badge--friendly">😊 Friendly −20%</span>`
    : mult > 1
      ? `<span class="merch-relation-badge merch-relation-badge--hostile">😠 Hostile +20%</span>`
      : "";

  return (discountBadge ? `<div class="merch-relation-row">${discountBadge}</div>` : "") +
    _shop.items
      .map((shopItem) => {
        const template = isEquippable(shopItem.itemId);
        const icon = shopItem.icon ?? template?.icon ?? "📦";
        const name = shopItem.name ?? template?.name ?? shopItem.itemId;
        const desc = shopItem.description ?? template?.description ?? "";
        const slotMeta = template ? EQUIPMENT_SLOTS[template.slot] : null;

        const badge = slotMeta
          ? `<span class="merch-badge merch-badge--${template.slot}">${slotMeta.icon} ${slotMeta.label}</span>`
          : "";
        const consumableBadge =
          !template &&
          (shopItem.itemId?.includes("potion") ||
            shopItem.itemId?.includes("elixir"))
          ? `<span class="merch-badge merch-badge--consumable">🧪 Consumable</span>`
          : "";

        const finalPrice = _adjustedPrice(shopItem.price);
        const canAfford = gold >= finalPrice;

        return `
          <div class="merch-item ${canAfford ? "" : "merch-item--poor"}">
            <span class="merch-item-icon">${icon}</span>
            <div class="merch-item-info">
              <div class="merch-item-title">
                <span class="merch-item-name">${name}</span>
                ${badge}${consumableBadge}
              </div>
              ${desc ? `<span class="merch-item-desc">${desc}</span>` : ""}
            </div>
            <div class="merch-item-right">
              <span class="merch-price ${canAfford ? "" : "merch-price--poor"}">
                🪙 ${finalPrice}${mult !== 1 ? `<span class="merch-price-orig"> (${shopItem.price})</span>` : ""}
              </span>
              <button
                class="merch-btn merch-btn--buy"
                data-item-id="${shopItem.itemId}"
                data-price="${finalPrice}"
                data-name="${encodeURIComponent(name)}"
                ${!canAfford ? "disabled title='Not enough gold'" : ""}
              >Buy</button>
            </div>
          </div>`;
        })
      .join("");

  // Equipped items can't be sold — unequip first
  const sellable = inventory.filter((i) => !i.equipped);

  if (!sellable.length) {
    return `<p class="merchant-empty">
      Your pack is empty${inventory.length ? " — unequip items before selling." : "."}
    </p>`;
  }

  return sellable
    .map((item) => {
      const template = isEquippable(item.itemId);
      const icon = template?.icon ?? "📦";
      const sellPrice = item.value
        ? Math.max(1, Math.floor(item.value / 2))
        : 0;
      const priceText = sellPrice ? `🪙 ${sellPrice}` : "No value";
      const canSell = sellPrice > 0;

      return `
      <div class="merch-item">
        <span class="merch-item-icon">${icon}</span>
        <div class="merch-item-info">
          <div class="merch-item-title">
            <span class="merch-item-name">${item.name}</span>
            ${item.quantity > 1 ? `<span class="merch-qty">×${item.quantity}</span>` : ""}
          </div>
          ${item.description ? `<span class="merch-item-desc">${item.description}</span>` : ""}
        </div>
        <div class="merch-item-right">
          <span class="merch-price ${canSell ? "" : "merch-price--dim"}">${priceText}</span>
          <button
            class="merch-btn merch-btn--sell"
            data-item-id="${item.itemId}"
            data-sell-price="${sellPrice}"
            data-item-name="${encodeURIComponent(item.name)}"
            data-can-sell="${canSell}"
          >Sell</button>
        </div>
      </div>`;
    })
    .join("");
}

// ── Button wiring ─────────────────────────────────────────────────────────────

function _wireButtons() {
  const body = document.getElementById("merchant-body");
  if (!body) return;

  // ── Buy ──────────────────────────────────────────────────────────────────
  body.querySelectorAll(".merch-btn--buy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = btn.dataset.itemId;
      const price = Number(btn.dataset.price);
      const name = decodeURIComponent(btn.dataset.name);
      const state = gameStore.getState();

      if (state.player.gold < price) return; // double-check

      const shopItem = _shop.items.find((i) => i.itemId === itemId);
      const template = isEquippable(itemId);

      const ok = modifyGold(-price);
      if (!ok) return;

      addItem({
        itemId,
        name: shopItem?.name ?? template?.name ?? name,
        quantity: 1,
        description:
          shopItem?.description ?? template?.description ?? undefined,
        value: shopItem?.value ?? undefined,
        healDice: shopItem?.healDice ?? undefined,
      });

      eventBus.emit(EVENTS.UI_NOTIFICATION, {
        text: `🛒 Purchased: ${name} for 🪙 ${price}`,
        type: "success",
        ttl: 2500,
      });
      playSFX("buy");
    });
  });

  // ── Sell ─────────────────────────────────────────────────────────────────
  body.querySelectorAll(".merch-btn--sell").forEach((btn) => {
    btn.addEventListener("click", () => {
      const itemId = btn.dataset.itemId;
      const name = decodeURIComponent(btn.dataset.itemName);
      const canSell = btn.dataset.canSell === "true";
      const sellPrice = Number(btn.dataset.sellPrice);

      if (!canSell) {
        eventBus.emit(EVENTS.UI_NOTIFICATION, {
          text: `The merchant has no interest in that.`,
          type: "error",
          ttl: 2000,
        });
        return;
      }

      const removed = removeItem(itemId, 1);
      if (!removed) return;

      modifyGold(sellPrice);
      playSFX("sell");

      eventBus.emit(EVENTS.UI_NOTIFICATION, {
        text: `💰 Sold: ${name} for 🪙 ${sellPrice}`,
        type: "success",
        ttl: 2500,
      });
    });
  });
}
