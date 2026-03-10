import { defineConfig } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fantasy Grounds module maps → public URL mapping
const FG_MAPS = {
  "/assets/battlemaps/map_nightstone.jpg": path.join(
    __dirname,
    "DDLE5_-_A_Great_Upheaval",
    "Map 1.1 - Nightstone.jpg",
  ),
  "/assets/battlemaps/map_dripping_caves.jpg": path.join(
    __dirname,
    "DDLE5_-_A_Great_Upheaval",
    "Map 1.2 - Dripping Caves.jpg",
  ),
  "/assets/battlemaps/map_zephyros_tower.jpg": path.join(
    __dirname,
    "DDLE5_-_A_Great_Upheaval",
    "Map 1.3 - Tower of Zephyros.jpg",
  ),
};

/**
 * Vite plugin: serves Fantasy Grounds map images from the module folder.
 * Dev:   middleware intercepts /assets/battlemaps/map_*.jpg requests
 * Build: emits the files as static assets into dist/
 */
function fgMapsPlugin() {
  return {
    name: "fg-maps",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Strip query string for matching
        const urlPath = req.url.split("?")[0];
        const localFile = FG_MAPS[urlPath];
        if (localFile && fs.existsSync(localFile)) {
          res.setHeader("Content-Type", "image/jpeg");
          res.setHeader("Cache-Control", "public, max-age=86400");
          fs.createReadStream(localFile).pipe(res);
          return;
        }
        next();
      });
    },

    generateBundle() {
      for (const [url, filePath] of Object.entries(FG_MAPS)) {
        if (fs.existsSync(filePath)) {
          this.emitFile({
            type: "asset",
            fileName: url.replace(/^\//, ""), // strip leading /
            source: fs.readFileSync(filePath),
          });
        } else {
          console.warn(`[fg-maps] File not found, skipping: ${filePath}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [fgMapsPlugin()],
});
