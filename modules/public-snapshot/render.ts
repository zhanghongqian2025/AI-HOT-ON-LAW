import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PublicSnapshot } from "./types.ts";

const STATIC_FILES = ["index.html", "app.js", "app.css", "logo.svg"] as const;
const STATIC_DIR = new URL("./static/", import.meta.url);

async function writeAtomic(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o644 });
  await rename(temporary, file);
}

/** Write the dependency-free GitHub Pages edition. The caller supplies an already public snapshot. */
export async function writePublicSite(destination: string, snapshot: PublicSnapshot): Promise<void> {
  if (snapshot.schemaVersion !== 1) throw new Error("Unsupported public snapshot schema version");
  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });

  await Promise.all(STATIC_FILES.map(async (name) => {
    const target = path.join(root, name);
    const temporary = `${target}.${process.pid}.tmp`;
    await copyFile(new URL(name, STATIC_DIR), temporary);
    await rename(temporary, target);
  }));
  await Promise.all([
    writeAtomic(path.join(root, "data.json"), `${JSON.stringify(snapshot, null, 2)}\n`),
    writeAtomic(path.join(root, ".nojekyll"), ""),
  ]);
}
