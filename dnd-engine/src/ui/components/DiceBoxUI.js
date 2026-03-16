let _ready = false;
let _overlayElement = null;
let _diceElement = null;
let _instructionsElement = null;

let _pendingSession = null;
let _isRolling = false;
let _queue = Promise.resolve();

function _randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function _wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _enqueue(task) {
  _queue = _queue.then(task, task);
  return _queue;
}

function _cacheDom() {
  _overlayElement = document.querySelector("#dice-click-overlay");
  _diceElement = document.querySelector("#dice-click-box");
  _instructionsElement = document.querySelector("#dice-click-instructions");
}

function _showOverlay(instructions = "Kattints a kockára a dobáshoz!") {
  _instructionsElement.textContent = instructions;
  _diceElement.textContent = "?";
  _diceElement.dataset.side = "1";
  _overlayElement.classList.remove("hidden");
}

function _hideOverlay() {
  _overlayElement.classList.add("hidden");
}

function _getDisplayValue(result, fallbackSides = 6) {
  if (typeof result === "number") return Math.max(1, Math.floor(result));
  if (result && typeof result === "object") {
    return (
      result.used?.[0] ??
      result.dice?.[0] ??
      result.total ??
      _randomInt(1, Math.max(2, fallbackSides))
    );
  }
  return _randomInt(1, Math.max(2, fallbackSides));
}

function _finishSession(result) {
  const session = _pendingSession;
  _pendingSession = null;
  _isRolling = false;
  _hideOverlay();
  session?.resolve?.(result);
}

function _failSession(error) {
  const session = _pendingSession;
  _pendingSession = null;
  _isRolling = false;
  _hideOverlay();
  session?.reject?.(error);
}

async function _handleRollClick() {
  if (!_pendingSession || _isRolling) return;

  _isRolling = true;

  const session = _pendingSession;
  const sides = Math.max(2, Math.floor(session.sides ?? 6));

  let result;
  try {
    if (typeof session.getResult === "function") {
      result = await Promise.resolve(session.getResult());
    } else {
      result = _randomInt(1, sides);
    }
  } catch (error) {
    _failSession(error);
    return;
  }

  const displayValue =
    typeof session.displayValue === "function"
      ? session.displayValue(result)
      : _getDisplayValue(result, sides);

  _diceElement.classList.add("rolling");
  _diceElement.dataset.side = String(displayValue);

  await _wait(Math.max(0, Math.floor(session.rollAnimationMs ?? 500)));

  _diceElement.textContent = String(displayValue);
  _diceElement.classList.remove("rolling");

  await _wait(Math.max(0, Math.floor(session.resultHoldMs ?? 800)));

  _finishSession(result);
}

export function initDiceBoxUI() {
  if (_ready) return;

  _cacheDom();
  if (!_overlayElement || !_diceElement || !_instructionsElement) {
    console.warn("[DiceBoxUI] Dice click overlay elements not found.");
    return;
  }

  _overlayElement.addEventListener("click", (event) => {
    if (event.target === _overlayElement) _handleRollClick();
  });

  _diceElement.addEventListener("click", (event) => {
    event.stopPropagation();
    _handleRollClick();
  });

  document.addEventListener("keydown", (event) => {
    if (!_pendingSession) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    _handleRollClick().catch((err) => {
      console.error("[DiceBoxUI] Keyboard roll failed:", err);
    });
  });

  _ready = true;
}

/**
 * Wait for a user-driven dice click interaction.
 * Resolves when the user clicks the dice. Optional getResult callback can
 * provide the resolved payload (e.g. full RollResult object).
 *
 * @param {{
 *   sides?: number,
 *   instructions?: string,
 *   rollAnimationMs?: number,
 *   resultHoldMs?: number,
 *   getResult?: () => any,
 *   displayValue?: (result: any) => string|number,
 * }} [options]
 * @returns {Promise<any>}
 */
export function waitForRoll(options = {}) {
  return _enqueue(() => {
    if (!_ready) initDiceBoxUI();

    const sides = Math.max(2, Math.floor(options.sides ?? 6));
    const instructions =
      options.instructions ?? "Kattints a kockára a dobáshoz!";

    if (!_overlayElement || !_diceElement || !_instructionsElement) {
      if (typeof options.getResult === "function") {
        return Promise.resolve(options.getResult());
      }
      return Promise.resolve(_randomInt(1, sides));
    }

    return new Promise((resolve, reject) => {
      _pendingSession = {
        resolve,
        reject,
        sides,
        instructions,
        rollAnimationMs: Math.max(
          0,
          Math.floor(options.rollAnimationMs ?? 500),
        ),
        resultHoldMs: Math.max(0, Math.floor(options.resultHoldMs ?? 800)),
        getResult: options.getResult,
        displayValue: options.displayValue,
      };

      _showOverlay(instructions);
    });
  });
}

/**
 * Auto-show a roll result with the new dice UI style (no user click required).
 * Used to replace legacy DICE_ANIMATE rendering paths.
 *
 * @param {{
 *   sides?: number,
 *   result?: number,
 *   instructions?: string,
 *   rollAnimationMs?: number,
 *   resultHoldMs?: number,
 * }} [options]
 * @returns {Promise<number>}
 */
export function showAutoRoll(options = {}) {
  return _enqueue(async () => {
    if (!_ready) initDiceBoxUI();

    const sides = Math.max(2, Math.floor(options.sides ?? 6));
    const result =
      typeof options.result === "number"
        ? Math.max(1, Math.floor(options.result))
        : _randomInt(1, sides);
    const instructions = options.instructions ?? "Dobás eredmény";
    const rollAnimationMs = Math.max(
      0,
      Math.floor(options.rollAnimationMs ?? 320),
    );
    const resultHoldMs = Math.max(0, Math.floor(options.resultHoldMs ?? 420));

    if (!_overlayElement || !_diceElement || !_instructionsElement) {
      return result;
    }

    _showOverlay(instructions);
    _diceElement.classList.add("rolling");
    _diceElement.dataset.side = String(result);

    await _wait(rollAnimationMs);

    _diceElement.textContent = String(result);
    _diceElement.classList.remove("rolling");

    await _wait(resultHoldMs);

    _hideOverlay();
    return result;
  });
}
