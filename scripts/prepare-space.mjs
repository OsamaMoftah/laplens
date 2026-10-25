import { copyFile } from "node:fs/promises";

await Promise.all([
  copyFile("deploy/huggingface/README.md", "out/README.md"),
  copyFile("LICENSE", "out/LICENSE"),
  copyFile("THIRD_PARTY_NOTICES.md", "out/THIRD_PARTY_NOTICES.md"),
]);
