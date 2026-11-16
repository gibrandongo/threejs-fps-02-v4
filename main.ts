// main.ts — Skyline Siege entry program (plain JavaScript syntax only, so the
// grader's pinned Node 22 runs it without type stripping).
//
// Hands in the game: builds dossier.json from game/ and screenshots/ with the
// kit's vendored buildDossier, then copies game/ and screenshots/ to the
// output directory and writes the dossier beside them.
//
// Output discipline (proven server rejection on this competition): the output
// directory itself is NEVER removed — only its contents are cleared, one child
// at a time — because the grader runs as an unprivileged user with a read-only
// filesystem root. The dossier is built BEFORE the output directory is
// touched, so a build failure never leaves a half-written output behind.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-threejs.ts";

const TEXT_MAX_BYTES = 163840;

function main() {
  const root = dirname(fileURLToPath(import.meta.url));
  const gameDir = join(root, "game");
  const shotsDir = join(root, "screenshots");
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";

  // 1. Build the dossier first, from the repository's own game/ + screenshots/.
  const dossier = buildDossier(root, { text_max_bytes: TEXT_MAX_BYTES });

  // 2. Create the output directory (recursive: no error if it already exists).
  mkdirSync(outDir, { recursive: true });

  // 3. Clear only the output directory's CONTENTS, never the directory itself.
  const children = readdirSync(outDir);
  children.sort();
  for (const child of children) {
    rmSync(join(outDir, child), { recursive: true, force: true });
  }

  // 4. Copy the game and the screenshots in, then write the dossier.
  cpSync(gameDir, join(outDir, "game"), { recursive: true });
  if (existsSync(shotsDir)) {
    cpSync(shotsDir, join(outDir, "screenshots"), { recursive: true });
  }
  writeFileSync(join(outDir, "dossier.json"), dossier);
}

main();
