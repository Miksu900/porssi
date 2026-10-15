import { cpSync, mkdirSync, rmSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
cpSync("site", "dist", { recursive: true });
cpSync("src/engine.mjs", "dist/engine.mjs");
cpSync("src/bots.mjs", "dist/bots.mjs");
console.log("dist valmis");
