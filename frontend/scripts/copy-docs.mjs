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
