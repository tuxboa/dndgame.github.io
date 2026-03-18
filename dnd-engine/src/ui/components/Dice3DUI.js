import * as THREE from "three";

let _ready = false;
let _overlayElement = null;
let _instructionsElement = null;
let _containerElement = null;

let _pendingSession = null;
let _isRolling = false;
let _queue = Promise.resolve();

// Three.js scene variables
let _scene = null;
let _camera = null;
let _renderer = null;
let _dice = null;
let _animationId = null;

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

function _wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _enqueue(task) {
  _queue = _queue.then(task, task);
  return _queue;
}

function _cacheDom() {
  _overlayElement = document.querySelector("#dice-click-overlay");
  _instructionsElement = document.querySelector("#dice-click-instructions");
  // Create a container for Three.js inside the overlay
  _containerElement = document.querySelector("#dice-3d-container");
  if (!_containerElement) {
    _containerElement = document.createElement("div");
    _containerElement.id = "dice-3d-container";
    _containerElement.style.cssText = `
      width: 300px;
      height: 300px;
      position: relative;
    `;
    _overlayElement.insertBefore(_containerElement, _overlayElement.firstChild);
  }
}

function _createD20() {
  // Create icosahedron (D20)
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const material = new THREE.MeshPhongMaterial({
    color: 0x00ff00,
    emissive: 0x002200,
    shininess: 100,
    wireframe: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Add edge outlines
  const edges = new THREE.EdgesGeometry(geometry);
  const line = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: 0x16c784 }),
  );
  mesh.add(line);

  return mesh;
}

function _initScene() {
  if (_scene) return;

  // Scene
  _scene = new THREE.Scene();
  _scene.background = new THREE.Color(0x0a0a0a);

  // Camera
  _camera = new THREE.PerspectiveCamera(
    75,
    _containerElement.clientWidth / _containerElement.clientHeight,
    0.1,
    1000,
  );
  _camera.position.z = 3;

  // Renderer
  _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  _renderer.setSize(
    _containerElement.clientWidth,
    _containerElement.clientHeight,
  );
  _renderer.shadowMap.enabled = true;
  _containerElement.appendChild(_renderer.domElement);

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  _scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 7);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  _scene.add(directionalLight);

  // Create D20
  _dice = _createD20();
  _scene.add(_dice);

  // Start animation loop
  _animate();
}

function _animate() {
  _animationId = requestAnimationFrame(_animate);

  // Gentle rotation in idle state
  if (_dice && !_isRolling) {
    _dice.rotation.x += 0.003;
    _dice.rotation.y += 0.005;
  }

  _renderer.render(_scene, _camera);
}

function _showOverlay(instructions = "Kattints a kockára a dobáshoz!") {
  _instructionsElement.textContent = instructions;
  _overlayElement.classList.remove("hidden");

  if (!_scene) {
    _initScene();
  }
}

function _hideOverlay() {
  _overlayElement.classList.add("hidden");
}

function _getDisplayValue(result, fallbackSides = 20) {
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

function _getRollRotation(value) {
  // Normalize value to 0-19 for D20
  const normalized = Math.max(1, Math.min(20, Math.floor(value))) - 1;
  const angle = (normalized / 20) * Math.PI * 2;
  return {
    x: angle * 0.7,
    y: angle * 1.2,
    z: angle * 0.5,
  };
}

async function _rollDice(displayValue) {
  if (!_dice || _isRolling) return;

  _isRolling = true;

  // Rapid spinning animation
  const spinDuration = 600; // ms
  const spinStart = Date.now();
  const targetRotation = _getRollRotation(displayValue);

  const spin = () => {
    const elapsed = Date.now() - spinStart;
    const progress = Math.min(1, elapsed / spinDuration);

    // Chaotic spinning
    _dice.rotation.x += 0.3;
    _dice.rotation.y += 0.4;
    _dice.rotation.z += 0.2;

    if (progress < 1) {
      requestAnimationFrame(spin);
    } else {
      // Ease to final rotation
      _dice.rotation.x = targetRotation.x;
      _dice.rotation.y = targetRotation.y;
      _dice.rotation.z = targetRotation.z;
      _isRolling = false;
    }
  };

  spin();
  await _wait(600 + 300); // spin + hold time
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

  const session = _pendingSession;
  const sides = Math.max(2, Math.floor(session.sides ?? 20));

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

  await _rollDice(displayValue);
  _finishSession(result);
}

export function initDiceBoxUI() {
  if (_ready) return;
  _ready = true;

  _cacheDom();
  if (!_overlayElement || !_instructionsElement || !_containerElement) {
    console.warn("[Dice3DUI] Dice overlay elements not found.");
    return;
  }

  if (_overlayElement) {
    _overlayElement.addEventListener("click", (event) => {
      if (event.target === _overlayElement || event.target === _instructionsElement) {
        _handleRollClick();
      }
    });
  }

  if (_containerElement) {
    _containerElement.addEventListener("click", (event) => {
      event.stopPropagation();
      _handleRollClick();
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!_pendingSession) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    _handleRollClick().catch((err) => {
      console.error("[Dice3DUI] Keyboard roll failed:", err);
    });
  });

  console.log("[Dice3DUI] Initialized with 3D D20 rendering");
}

/**
 * Wait for a user-driven dice click interaction (3D D20).
 */
export function waitForRoll(options = {}) {
  return _enqueue(() => {
    if (!_ready) initDiceBoxUI();

    const sides = Math.max(2, Math.floor(options.sides ?? 20));
    const instructions = options.instructions ?? "Kattints a kockára a dobáshoz!";

    if (!_overlayElement || !_instructionsElement || !_containerElement) {
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
        rollAnimationMs: Math.max(0, Math.floor(options.rollAnimationMs ?? 500)),
        resultHoldMs: Math.max(0, Math.floor(options.resultHoldMs ?? 800)),
        getResult: options.getResult,
        displayValue: options.displayValue,
      };

      _showOverlay(instructions);
    });
  });
}

/**
 * Auto-show a roll result with 3D dice (no user click required).
 */
export function showAutoRoll(options = {}) {
  return _enqueue(async () => {
    if (!_ready) initDiceBoxUI();

    const sides = Math.max(2, Math.floor(options.sides ?? 20));
    const result =
      typeof options.result === "number"
        ? Math.max(1, Math.floor(options.result))
        : _randomInt(1, sides);
    const instructions = options.instructions ?? "Dobás eredmény";
    const rollAnimationMs = Math.max(0, Math.floor(options.rollAnimationMs ?? 320));
    const resultHoldMs = Math.max(0, Math.floor(options.resultHoldMs ?? 420));

    if (!_overlayElement || !_instructionsElement || !_containerElement) {
      return result;
    }

    _showOverlay(instructions);
    await _rollDice(result);
    await _wait(resultHoldMs);
    _hideOverlay();

    return result;
  });
}

export function cleanup() {
  if (_animationId) {
    cancelAnimationFrame(_animationId);
  }
  if (_renderer && _containerElement && _containerElement.contains(_renderer.domElement)) {
    _containerElement.removeChild(_renderer.domElement);
  }
  _renderer?.dispose();
  _scene = null;
  _camera = null;
  _renderer = null;
  _dice = null;
}
