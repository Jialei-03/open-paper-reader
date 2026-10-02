import { mkdir, copyFile, cp } from "node:fs/promises";
for (const folder of ["cmaps", "standard_fonts", "wasm"])
  await cp(`node_modules/pdfjs-dist/${folder}`, `dist/assets/pdfjs/${folder}`, {
    recursive: true,
  });
await mkdir("dist/swagger", { recursive: true });
for (const name of ["swagger-ui.css", "swagger-ui-bundle.js"])
  await copyFile(
    "node_modules/swagger-ui-dist/" + name,
    "dist/swagger/" + name,
  );
await mkdir("dist/licenses", { recursive: true });
for (const [source, name] of [
  ["@fontsource-variable/noto-sans-sc/LICENSE", "Noto-Sans-SC-OFL.txt"],
  ["@fontsource-variable/inter/LICENSE", "Inter-OFL.txt"],
  ["pdfjs-dist/LICENSE", "PDFjs-Apache-2.txt"],
  ["react/LICENSE", "React-MIT.txt"],
  ["swagger-ui-dist/LICENSE", "Swagger-UI-Apache-2.txt"],
]) {
  await copyFile("node_modules/" + source, "dist/licenses/" + name);
}

// Explicit download prepares the full local reader, including PDF workers/fonts.
const { readdir, readFile, writeFile } = await import("node:fs/promises");
const { createHash } = await import("node:crypto");
async function offlineAssets(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await offlineAssets(path)));
    else if (
      /\.(js|mjs|css|woff2?|bcmap|ttf|otf|wasm|pfb)$/i.test(path) ||
      path.includes("/icons/")
    )
      files.push("/" + path.slice(5));
  }
  return files.sort();
}
await writeFile(
  "dist/assets/offline-manifest.json",
  JSON.stringify({
    version: createHash("sha256")
      .update(await readFile("dist/index.html"))
      .digest("hex")
      .slice(0, 16),
    files: await offlineAssets("dist/assets"),
  }),
);
