import { expect, type Page } from "@playwright/test";
import { createPaperWithPdf, pdfWithPages, signIn } from "./fixtures";

export type Row = Record<string, unknown>;

export const MODELS = [
  { id: "model-1", name: "Fixture model", model: "fixture" },
];

/** A paper of `pages` pages and, on it, a finished translation PDF of `translatedPages`; the job is served as the service lists it. */
export async function paperWithTranslation(
  page: Page,
  options: {
    pages: number;
    translatedPages: number;
    /** The job's `alignment`: empty, as a layout translation leaves it. */
    alignment?: Row[];
    engine?: "latex" | "pdf";
    /** Leave the job running: there is no translated PDF to read. */
    unfinished?: boolean;
  },
) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, { pages: options.pages });
  const record = await (
    await page.request.get(`/api/v1/papers/${paper.paperId}`)
  ).json();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const upload = await page.request.post(
    `/api/v1/papers/${paper.paperId}/files`,
    {
      headers: {
        "X-CSRF-Token": csrf,
        "Idempotency-Key": crypto.randomUUID(),
      },
      multipart: {
        version_id: record.current_version,
        file: {
          name: "zh-paper.pdf",
          mimeType: "application/pdf",
          buffer: pdfWithPages(options.translatedPages, [], {
            words: { 1: "Translated copy" },
          }),
        },
      },
    },
  );
  expect(upload.ok()).toBeTruthy();
  const translatedId: string = (await upload.json()).id;
  const engine = options.engine ?? "pdf";
  const job: Row = {
    id: "job-1",
    engine,
    version_id: record.current_version,
    status: options.unfinished ? "running" : "completed",
    stage: options.unfinished ? "正在翻译" : "翻译完成",
    completed: options.unfinished ? 10 : 100,
    total: 100,
    error: "",
    source_file: engine === "pdf" ? paper.fileId : "",
    translated_file: options.unfinished ? "" : translatedId,
    alignment: options.alignment ?? [],
  };
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        models: MODELS,
        active_id: "model-1",
        configured: true,
        pdf_layout_enabled: true,
        latex_translation_available: true,
        latex_installable: false,
      },
    }),
  );
  await page.route(`**/api/v1/papers/${paper.paperId}/translations`, (route) =>
    route.fulfill({ json: [job] }),
  );
  return { ...paper, translatedId, job };
}
