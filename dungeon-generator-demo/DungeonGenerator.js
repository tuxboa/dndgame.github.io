/**
 * @typedef {object} Room
 * @property {number} x - A szoba bal felső sarkának x koordinátája.
 * @property {number} y - A szoba bal felső sarkának y koordinátája.
 * @property {number} w - A szoba szélessége.
 * @property {number} h - A szoba magassága.
 */

/**
 * Tile típusok a pályán.
 * @readonly
 * @enum {number}
 */
export const TILE_TYPE = {
  WALL: 0,
  FLOOR: 1,
};

export class DungeonGenerator {
  /**
   * @param {number} width - A pálya szélessége.
   * @param {number} height - A pálya magassága.
   * @param {object} ecs - Az Entity-Component-System referencia, amellyel az entitásokat létrehozzuk.
   */
  constructor(width, height, ecs) {
    this.width = width;
    this.height = height;
    this.ecs = ecs;
    this.grid = [];
    /** @type {Room[]} */
    this.rooms = [];
  }

  /**
   * Legenerálja a teljes dungeon pályát.
   * @param {number} maxRooms - A generálandó szobák maximális száma.
   * @param {number} minRoomSize - A szobák minimális mérete.
   * @param {number} maxRoomSize - A szobák maximális mérete.
   * @param {number} maxEnemiesPerRoom - Egy szobában elhelyezhető ellenségek maximális száma.
   * @returns {number[][]} A generált 2D pálya.
   */
  generate(maxRooms, minRoomSize, maxRoomSize, maxEnemiesPerRoom) {
    this.#initializeGrid();
    this.#createRooms(maxRooms, minRoomSize, maxRoomSize);
    this.#connectRooms();
    this.#placeEnemies(maxEnemiesPerRoom);

    return this.grid;
  }

  /**
   * Feltölti a teljes pályát falakkal.
   * @private
   */
  #initializeGrid() {
    this.grid = Array.from({ length: this.height }, () =>
      Array(this.width).fill(TILE_TYPE.WALL),
    );
  }

  /**
   * Létrehozza és elhelyezi a szobákat a pályán.
   * @private
   */
  #createRooms(maxRooms, minRoomSize, maxRoomSize) {
    this.rooms = [];
    for (let i = 0; i < maxRooms; i++) {
      const w = this.#randomInt(minRoomSize, maxRoomSize);
      const h = this.#randomInt(minRoomSize, maxRoomSize);
      const x = this.#randomInt(1, this.width - w - 1);
      const y = this.#randomInt(1, this.height - h - 1);

      const newRoom = { x, y, w, h };

      const intersects = this.rooms.some((room) =>
        this.#roomsIntersect(newRoom, room),
      );

      if (!intersects) {
        this.#carveRoom(newRoom);
        this.rooms.push(newRoom);
      }
    }
  }

  /**
   * Összeköti a szobákat folyosókkal.
   * @private
   */
  #connectRooms() {
    if (this.rooms.length < 2) return;

    for (let i = 1; i < this.rooms.length; i++) {
      const centerA = this.#getRoomCenter(this.rooms[i - 1]);
      const centerB = this.#getRoomCenter(this.rooms[i]);
      this.#createCorridor(centerA, centerB);
    }
  }

  /**
   * "Kivág" egy szobát a falakból.
   * @param {Room} room
   * @private
   */
  #carveRoom(room) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        this.grid[y][x] = TILE_TYPE.FLOOR;
      }
    }
  }

  /**
   * L-alakú folyosót készít két pont között.
   * @param {{x: number, y: number}} start
   * @param {{x: number, y: number}} end
   * @private
   */
  #createCorridor(start, end) {
    const x = start.x;
    const y = start.y;

    if (Math.random() < 0.5) {
      this.#carveHorizontalPassage(x, end.x, y);
      this.#carveVerticalPassage(y, end.y, end.x);
    } else {
      this.#carveVerticalPassage(y, end.y, x);
      this.#carveHorizontalPassage(x, end.x, end.y);
    }
  }

  #carveHorizontalPassage(x1, x2, y) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      this.grid[y][x] = TILE_TYPE.FLOOR;
    }
  }

  #carveVerticalPassage(y1, y2, x) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
      this.grid[y][x] = TILE_TYPE.FLOOR;
    }
  }

  /**
   * Elhelyezi az ellenségeket a szobákban az ECS segítségével.
   * @param {number} maxEnemiesPerRoom
   * @private
   */
  #placeEnemies(maxEnemiesPerRoom) {
    if (!this.ecs) return;

    this.rooms.forEach((room) => {
      const enemyCount = this.#randomInt(0, maxEnemiesPerRoom);
      const occupied = new Set();

      for (let i = 0; i < enemyCount; i++) {
        const x = this.#randomInt(room.x, room.x + room.w - 1);
        const y = this.#randomInt(room.y, room.y + room.h - 1);
        const key = `${x},${y}`;

        if (this.grid[y][x] === TILE_TYPE.FLOOR && !occupied.has(key)) {
          occupied.add(key);
          this.ecs
            .createEntity()
            .with({ type: "Position", x, y })
            .with({ type: "Renderable", char: "E", color: "red" })
            .with({ type: "Enemy", hp: 100 });
        }
      }
    });
  }

  /**
   * Segédfüggvény egy szoba középpontjának meghatározásához.
   * @param {Room} room
   * @returns {{x: number, y: number}}
   * @private
   */
  #getRoomCenter(room) {
    return {
      x: Math.floor(room.x + room.w / 2),
      y: Math.floor(room.y + room.h / 2),
    };
  }

  /**
   * Ellenőrzi, hogy két szoba (némi ráhagyással) metszi-e egymást.
   * @param {Room} roomA
   * @param {Room} roomB
   * @returns {boolean}
   * @private
   */
  #roomsIntersect(roomA, roomB) {
    const padding = 2;
    return (
      roomA.x < roomB.x + roomB.w + padding &&
      roomA.x + roomA.w + padding > roomB.x &&
      roomA.y < roomB.y + roomB.h + padding &&
      roomA.y + roomA.h + padding > roomB.y
    );
  }

  /**
   * Véletlen egész számot generál két érték között (zárt intervallum).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   * @private
   */
  #randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
