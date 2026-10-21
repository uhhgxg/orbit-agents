/**
 * WhatsApp worker build script.
 *
 * Bundles the Baileys-backed WhatsApp subprocess into a single CJS file at
 * packages/messaging-whatsapp-worker/dist/worker.cjs.
 *
 * Baileys is bundled INTO the output (not marked external) so the packaged
 * app ships a self-contained worker — users don't have to install anything.
 * The dynamic import at runtime still works because esbuild resolves literal
 * dynamic-import strings at bundle time.
 *
 * The worker is spawned as a Node subprocess by the WhatsAppAdapter:
 *   - Electron: re-enters its embedded Node via ELECTRON_RUN_AS_NODE=1.
 *   - Headless/Bun server: spawns a system `node` binary (Bun cannot run the
 *     CJS worker because Baileys' crypto deps depend on Node's runtime).
 * That's why we emit CJS + platform=node — it must stay Node-compatible.
 */

import { spawn } from "bun";
import { execSync } from "child_process";
import { existsSync, mkdirSync, statSync } from "fs";
import { join } from "path";
import * as esbuild from "esbuild";

/**
 * Resolve a short git SHA for the build, suffixed with `+dirty` when the
 * working tree has uncommitted changes. Returns `unknown` outside a git
 * checkout.
 */
function resolveGitSha(cwd: string): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd }).toString().trim();
    let dirty = false;
    try {
      const status = execSync("git status --porcelain", { cwd }).toString().trim();
      dirty = status.length > 0;
    } catch {
      // ignore — treat as clean
    }
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return "unknown";
  }
}

const ROOT_DIR = join(import.meta.dir, "..");
const WORKER_DIR = join(ROOT_DIR, "packages/messaging-whatsapp-worker");
const SOURCE = join(WORKER_DIR, "src/worker.ts");
const DIST_DIR = join(WORKER_DIR, "dist");
const OUTPUT = join(DIST_DIR, "worker.cjs");

async function verifyJsFile(filePath: string): Promise<{ valid: boolean; error?: string }> {
  if (!existsSync(filePath)) return { valid: false, error: "File does not exist" };
  const stats = statSync(filePath);
  if (stats.size === 0) return { valid: false, error: "File is empty" };

  const proc = spawn({
    cmd: ["node", "--check", filePath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) return { valid: false, error: stderr || "Syntax error" };
  return { valid: true };
}

async function main(): Promise<void> {
  if (!existsSync(SOURCE)) {
    console.error("❌ WhatsApp worker source not found at", SOURCE);
    process.exit(1);
  }

  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }

  const buildId = new Date().toISOString();
  const gitSha = resolveGitSha(ROOT_DIR);
  console.log(`📨 Building WhatsApp worker (bundling Baileys) — build ${buildId} (${gitSha})...`);

  // NOTE: We deliberately use the esbuild JavaScript API (not the `esbuild`
  // CLI via `bun run esbuild`). On Windows, bun shells out to `esbuild.cmd`
  // through cmd.exe, and any argument containing a double quote (which
  // `--define:KEY="value"` always produces) is rejected with
  // `ERR_INVALID_ARG_VALUE: contains a cmd.exe special character`.
  // The JS API passes options in-process and is identical on all platforms.
  try {
    await esbuild.build({
      entryPoints: [SOURCE],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      outfile: OUTPUT,
      // Inject build provenance. The worker logs these on startup so an
      // operator can confirm a rebuild actually propagated to the running
      // subprocess after `bun run build:wa-worker`.
      define: {
        __WA_WORKER_BUILD_ID__: JSON.stringify(buildId),
        __WA_WORKER_GIT_SHA__: JSON.stringify(gitSha),
      },
      // Mark only Electron + Baileys' runtime-optional peers external.
      // Baileys itself and all its required transitive deps get bundled.
      //
      // The three optional deps below are unused by Orbit Agent (no link
      // previews, no terminal QR, no inline image transforms). Baileys
      // guards them with try/catch so they fail silently at runtime.
      external: ["electron", "link-preview-js", "qrcode-terminal", "jimp"],
      logLevel: "warning",
    });
  } catch (err) {
    console.error("❌ WhatsApp worker build failed:", String(err));
    process.exit(1);
  }

  if (!existsSync(OUTPUT)) {
    console.error("❌ WhatsApp worker output not found at", OUTPUT);
    process.exit(1);
  }

  console.log("🔍 Verifying worker output...");
  const verification = await verifyJsFile(OUTPUT);
  if (!verification.valid) {
    console.error("❌ Worker build verification failed:", verification.error);
    process.exit(1);
  }

  const { size } = statSync(OUTPUT);
  console.log(`✅ WhatsApp worker built (${(size / 1024 / 1024).toFixed(2)} MB) → ${OUTPUT}`);
}

main().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
