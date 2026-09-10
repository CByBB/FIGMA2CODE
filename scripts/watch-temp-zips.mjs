/**
 * Watch `.temp` for plugin ZIP downloads: extract to a same-named folder, then
 * delete the ZIP. On startup, any existing ZIPs are removed without extracting.
 *
 * Usage: pnpm dev:temp
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  rmSync,
  watch,
} from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TEMP = join(ROOT, ".temp");
const STABLE_MS = 400;
const pending = new Map();

function log(msg) {
  const t = new Date().toLocaleTimeString();
  console.log(`[dev:temp ${t}] ${msg}`);
}

function listZips() {
  if (!existsSync(TEMP)) return [];
  return readdirSync(TEMP)
    .filter((n) => extname(n).toLowerCase() === ".zip")
    .map((n) => join(TEMP, n));
}

function removeZip(zipPath) {
  try {
    if (existsSync(zipPath)) unlinkSync(zipPath);
    log(`removed ${basename(zipPath)}`);
  } catch (e) {
    log(`failed to remove ${basename(zipPath)}: ${e.message}`);
  }
}

function extractZip(zipPath, destDir) {
  if (platform() === "win32") {
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory(${JSON.stringify(zipPath)}, ${JSON.stringify(destDir)})
`;
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", ps],
      { encoding: "utf8" },
    );
    if (r.status !== 0) {
      throw new Error((r.stderr || r.stdout || "Expand failed").trim());
    }
    return;
  }

  const r = spawnSync("unzip", ["-o", zipPath, "-d", destDir], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "unzip failed").trim());
  }
}

function handleZipReady(zipPath) {
  const name = basename(zipPath, ".zip");
  const destDir = join(TEMP, name);

  try {
    if (!existsSync(zipPath)) return;
    const size = statSync(zipPath).size;
    if (size < 22) {
      log(`skip empty/incomplete ${basename(zipPath)}`);
      return;
    }

    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true, force: true });
      log(`cleared existing ${name}/`);
    }
    mkdirSync(destDir, { recursive: true });

    extractZip(zipPath, destDir);
    log(`extracted → .temp/${name}/`);
    removeZip(zipPath);
  } catch (e) {
    log(`extract failed for ${basename(zipPath)}: ${e.message}`);
  }
}

function scheduleZip(zipPath) {
  const prev = pending.get(zipPath);
  if (prev) clearTimeout(prev.timer);

  const entry = { lastSize: -1, timer: null };
  pending.set(zipPath, entry);

  const tick = () => {
    try {
      if (!existsSync(zipPath)) {
        pending.delete(zipPath);
        return;
      }
      const size = statSync(zipPath).size;
      if (size !== entry.lastSize) {
        entry.lastSize = size;
        entry.timer = setTimeout(tick, STABLE_MS);
        pending.set(zipPath, entry);
        return;
      }
      pending.delete(zipPath);
      handleZipReady(zipPath);
    } catch {
      pending.delete(zipPath);
    }
  };

  entry.timer = setTimeout(tick, STABLE_MS);
}

function onTempEvent(filename) {
  if (!filename || extname(filename).toLowerCase() !== ".zip") return;
  scheduleZip(join(TEMP, filename));
}

function main() {
  if (!existsSync(TEMP)) {
    mkdirSync(TEMP, { recursive: true });
    log("created .temp/");
  }

  const existing = listZips();
  for (const zip of existing) {
    removeZip(zip);
  }
  if (existing.length === 0) {
    log("no existing zips");
  }

  watch(TEMP, { persistent: true }, (_event, filename) => {
    if (typeof filename === "string") onTempEvent(filename);
  });

  log(`watching ${TEMP} for *.zip`);
}

main();
