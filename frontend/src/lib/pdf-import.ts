import { api, send, type Paper } from "../api";

export const PDF_LIMIT_BYTES = 50 * 1024 * 1024;
export type ImportStage = "reading" | "creating" | "uploading";

export const isPdf = (file: File) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

const fromFilename = (name: string) =>
  name
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "未命名论文";

// Titles that PDF producers write by default and that say nothing about the paper.
const junkTitle =
  /^(untitled|无标题|microsoft word\b|.*\.(docx?|tex|dvi|ps|indd|pdf)$|main$|paper\d*$)/i;

type PdfText = {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
};

/**
 * Read a usable title (and the arXiv id when the first page carries the stamp)
 * from the file itself, so a dropped PDF needs no form. Falls back to the file
 * name; the user can always rename in paper settings.
 */
export async function readPdfInfo(
  file: File,
): Promise<{ title: string; externalId: string }> {
  const fallback = { title: fromFilename(file.name), externalId: "" };
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      cMapUrl: "/assets/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
      wasmUrl: "/assets/pdfjs/wasm/",
    });
    try {
      const doc = await task.promise;
      const meta = await doc.getMetadata().catch(() => null);
      const info = (meta?.info || {}) as Record<string, unknown>;
      const page = await doc.getPage(1);
      const { height: pageHeight } = page.getViewport({ scale: 1 });
      const items = (await page.getTextContent()).items.filter(
        (i): i is typeof i & PdfText => "str" in i && "transform" in i,
      ) as PdfText[];
      const all = items.map((i) => i.str).join(" ");
      const arxiv = all.match(/arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)/i);
      const externalId = arxiv ? `arxiv:${arxiv[1]}` : "";
      const declared = String(info.Title || "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        declared.length >= 8 &&
        declared.length <= 300 &&
        !junkTitle.test(declared) &&
        declared.toLowerCase() !== fromFilename(file.name).toLowerCase()
      )
        return { title: declared, externalId };
      // Otherwise: the largest upright text in the upper part of page one.
      const size = (i: PdfText) => Math.abs(i.transform[3]) || i.height || 0;
      const upper = items.filter(
        (i) =>
          i.str.trim() &&
          Math.abs(i.transform[1]) < 0.05 &&
          Math.abs(i.transform[2]) < 0.05 &&
          i.transform[5] > pageHeight * 0.35,
      );
      // Body text size: the median size of all upright text on the page.
      const sizes = items
        .filter(
          (i) =>
            i.str.trim() &&
            Math.abs(i.transform[1]) < 0.05 &&
            Math.abs(i.transform[2]) < 0.05,
        )
        .map(size)
        .sort((a, b) => a - b);
      const body = sizes[Math.floor(sizes.length / 2)] || 0;
      const largest = Math.max(
        0,
        ...upper.filter((i) => i.str.trim().length >= 3).map(size),
      );
      // A real title stands clearly above the body text; if nothing does, use the file name.
      if (largest < body * 1.15) return { ...fallback, externalId };
      const big = upper
        .filter((i) => size(i) >= largest * 0.88 && size(i) > 9)
        .sort(
          (a, b) =>
            b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
        );
      // Join fragments by their real horizontal gap, so "Mem0" + ":" stays "Mem0:".
      let guess = "";
      big.forEach((item, index) => {
        const prev = big[index - 1];
        if (prev) {
          const fontSize = size(item);
          const sameLine =
            Math.abs(prev.transform[5] - item.transform[5]) < fontSize * 0.5;
          const gap =
            item.transform[4] - (prev.transform[4] + (prev.width || 0));
          if (!sameLine) guess += /[-\u2010-\u2014]$/.test(guess) ? "" : " ";
          else if (gap > fontSize * 0.12) guess += " ";
        }
        guess += item.str;
      });
      guess = guess.replace(/\s+/g, " ").trim();
      if (
        guess.length >= 8 &&
        guess.length <= 300 &&
        guess.split(" ").length >= 2 &&
        !junkTitle.test(guess)
      )
        return { title: guess, externalId };
      return { ...fallback, externalId };
    } finally {
      void task.destroy();
    }
  } catch {
    return fallback;
  }
}

/** Create the paper and attach the PDF in one step; undo the shell if upload fails. */
export async function importPdf(
  file: File,
  onStage?: (stage: ImportStage) => void,
): Promise<Paper> {
  if (!isPdf(file)) throw new Error(`「${file.name}」不是 PDF 文件`);
  if (!file.size) throw new Error(`「${file.name}」是空文件`);
  if (file.size > PDF_LIMIT_BYTES)
    throw new Error(`「${file.name}」超过 50 MB 上限`);
  onStage?.("reading");
  const info = await readPdfInfo(file);
  onStage?.("creating");
  const paper = (await send("/papers", {
    title: info.title.slice(0, 500),
    authors: "",
    abstract: "",
    external_id: info.externalId,
    tags: [],
    version_label: "v1",
    provenance: `上传 PDF：${file.name}`.slice(0, 10000),
  })) as Paper;
  try {
    onStage?.("uploading");
    const body = new FormData();
    body.set("file", file, file.name);
    body.set("version_id", paper.current_version);
    await api("/papers/" + paper.id + "/files", { method: "POST", body });
  } catch (error) {
    await api("/papers/" + paper.id, {
      method: "DELETE",
      headers: {
        "If-Match": String(paper.revision),
        "X-Confirm-Delete": paper.id,
      },
    }).catch(() => undefined);
    throw error;
  }
  return paper;
}
