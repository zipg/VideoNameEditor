import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ffprobe from "@ffprobe-installer/ffprobe";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.argv[2] || process.env.TAURI_TARGET || targetFromHost();

if (!target) {
  throw new Error("Missing Tauri target triple. Pass it as the first argument.");
}

const outputName = target.endsWith("windows-msvc") ? `ffprobe-${target}.exe` : `ffprobe-${target}`;
const outputPath = join(rootDir, "src-tauri", "binaries", outputName);

mkdirSync(dirname(outputPath), { recursive: true });
copyFileSync(ffprobe.path, outputPath);
chmodSync(outputPath, 0o755);

console.log(`Prepared ffprobe sidecar: ${outputPath}`);

function targetFromHost() {
  if (process.platform === "darwin" && process.arch === "arm64") return "aarch64-apple-darwin";
  if (process.platform === "darwin" && process.arch === "x64") return "x86_64-apple-darwin";
  if (process.platform === "win32" && process.arch === "x64") return "x86_64-pc-windows-msvc";
  return undefined;
}
