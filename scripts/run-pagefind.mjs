import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const siteDir = path.join(process.cwd(), "_site");
const importDir = path.join(siteDir, "pagefind-import");

async function hasImportHtmlFiles() {
  try {
    const entries = await fs.readdir(importDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith(".html"));
  } catch {
    return false;
  }
}

function runPagefind() {
  return new Promise((resolve, reject) => {
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    const child = spawn(
      npxCmd,
      ["pagefind", "--site", "_site", "--glob", "pagefind-import/**/*.html"],
      { stdio: "inherit" }
    );

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Pagefind exited with code ${code}`));
    });
  });
}

async function run() {
  const hasFiles = await hasImportHtmlFiles();
  if (!hasFiles) {
    console.log("[pagefind] skipping index build (no pagefind-import HTML files found)");
    return;
  }

  await runPagefind();
}

run().catch((error) => {
  console.error("[pagefind] failed", error);
  process.exit(1);
});
