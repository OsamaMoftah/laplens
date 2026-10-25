import { copyFile, rm } from "node:fs/promises";

if (process.argv.includes("--clean")) {
  await Promise.all(
    ["out", ".next"].map((path) => rm(path, { recursive: true, force: true })),
  );
} else {
  await Promise.all([
    copyFile("README.md", "out/README.md"),
    copyFile("screenshot.png", "out/screenshot.png"),
    copyFile("LICENSE", "out/LICENSE"),
    copyFile("THIRD_PARTY_NOTICES.md", "out/THIRD_PARTY_NOTICES.md"),
  ]);
}
