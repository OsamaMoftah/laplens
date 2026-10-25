import { createHash } from "node:crypto";
import { join } from "node:path";
import { copyFile, rm, readFile, writeFile, readdir } from "node:fs/promises";

if (process.argv.includes("--clean")) {
  await Promise.all(
    ["out", ".next"].map((path) => rm(path, { recursive: true, force: true })),
  );
} else {
  await hardenHtml("out");
  await Promise.all([
    copyFile("README.md", "out/README.md"),
    copyFile("SECURITY.md", "out/SECURITY.md"),
    copyFile("screenshot.png", "out/screenshot.png"),
    copyFile("LICENSE", "out/LICENSE"),
    copyFile("THIRD_PARTY_NOTICES.md", "out/THIRD_PARTY_NOTICES.md"),
  ]);
}

async function hardenHtml(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await hardenHtml(path);
      continue;
    }
    if (!entry.name.endsWith(".html")) continue;
    let html = await readFile(path, "utf8");
    const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
      .filter((match) => match[1].trim())
      .map(
        (match) =>
          "'sha256-" +
          createHash("sha256").update(match[1]).digest("base64") +
          "'",
      );
    const cdn =
      "https://*.hf.co https://*.huggingface.co https://*.xethub.hf.co";
    const policy = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      `script-src 'self' 'wasm-unsafe-eval' ${[...new Set(hashes)].join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      `media-src 'self' blob: ${cdn}`,
      `connect-src 'self' ${cdn}`,
      "worker-src 'self' blob:",
    ].join("; ");
    html = html.replace(
      /<meta http-equiv="Content-Security-Policy"[^>]*>/g,
      "",
    );
    const head = /<head\b[^>]*>(?:\s*<meta\b[^>]*charset[^>]*>)?/i;
    if (!head.test(html))
      throw new Error("Cannot apply CSP: missing HTML head in " + path);
    html = html.replace(
      head,
      (opening) =>
        `${opening}<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`,
    );
    await writeFile(path, html);
  }
}
