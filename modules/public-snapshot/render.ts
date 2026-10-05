import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PublicSnapshot } from "./types.ts";

const STATIC_DIR = new URL("./static/", import.meta.url);

async function writeAtomic(file: string, contents: string | Uint8Array): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o644 });
  await rename(temporary, file);
}

function version(contents: string): string {
  return createHash("sha256").update(contents).digest("hex").slice(0, 12);
}

function versionIndex(template: string, script: string, styles: string): string {
  if (!template.includes('href="./app.css"') || !template.includes('src="./app.js"')) {
    throw new Error("Public index is missing versionable app asset URLs");
  }
  return template
    .replace('href="./app.css"', `href="./app.css?v=${version(styles)}"`)
    .replace('src="./app.js"', `src="./app.js?v=${version(script)}"`);
}

/** Write the dependency-free GitHub Pages edition. The caller supplies an already public snapshot. */
export async function writePublicSite(destination: string, snapshot: PublicSnapshot): Promise<void> {
  if (snapshot.schemaVersion !== 1) throw new Error("Unsupported public snapshot schema version");
  const root = path.resolve(destination);
  await mkdir(root, { recursive: true });
  const [indexTemplate, script, styles, logo] = await Promise.all([
    readFile(new URL("index.html", STATIC_DIR), "utf8"),
    readFile(new URL("app.js", STATIC_DIR), "utf8"),
    readFile(new URL("app.css", STATIC_DIR), "utf8"),
    readFile(new URL("logo.svg", STATIC_DIR)),
  ]);
  const index = versionIndex(indexTemplate, script, styles);
  await Promise.all([
    writeAtomic(path.join(root, "index.html"), index),
    writeAtomic(path.join(root, "app.js"), script),
    writeAtomic(path.join(root, "app.css"), styles),
    writeAtomic(path.join(root, "logo.svg"), logo),
    writeAtomic(path.join(root, "data.json"), `${JSON.stringify(snapshot, null, 2)}\n`),
    writeAtomic(path.join(root, ".nojekyll"), ""),
  ]);
}
