import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, signIn } from "./fixtures";
import { MODELS, type Row } from "./translation-fixtures";

// Run with PERF=1. Scrolling cost of 原文 / 对照 / 译文 on dense pages. Prints the numbers.
test.use({ locale: "zh-CN", viewport: { width: 1600, height: 950 } });

const PAGES = 15;

/** A PDF of text-heavy pages (about 60 lines of 95 characters, in many small runs). */
function densePdf(pages: number, tag: string): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${4 + 2 * i} 0 R`).join(" ")}] /Count ${pages} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
  ];
  for (let p = 1; p <= pages; p++) {
    let stream = "BT /F1 9 Tf 12 TL 40 760 Td\n";
    for (let line = 0; line < 60; line++) {
      const words = Array.from(
        { length: 14 },
        (_, w) => `${tag}${p}x${line}y${w}lorem`,
      ).join(" ");
      stream += `(${words}) '\n`;
    }
    stream += "ET";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * (p - 1)} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

async function setup(page: Page) {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    buffer: densePdf(PAGES, "o"),
  });
  const record = await (
    await page.request.get(`/api/v1/papers/${paper.paperId}`)
  ).json();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const upload = await page.request.post(
    `/api/v1/papers/${paper.paperId}/files`,
    {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        version_id: record.current_version,
        file: {
          name: "zh-paper.pdf",
          mimeType: "application/pdf",
          buffer: densePdf(PAGES, "t"),
        },
      },
    },
  );
  const translatedId: string = (await upload.json()).id;
  const job: Row = {
    id: "job-1",
    engine: "pdf",
    version_id: record.current_version,
    status: "completed",
    stage: "翻译完成",
    completed: 100,
    total: 100,
    error: "",
    source_file: paper.fileId,
    translated_file: translatedId,
    alignment: [],
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
  await page.route("**/api/v1/papers/*/reading-artifacts", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: [] })
      : route.fulfill({ status: 503, json: { detail: "no" } }),
  );
  return paper;
}

async function measure(page: Page) {
  return page.evaluate(async () => {
    const long: number[] = [];
    const observer = new PerformanceObserver((list) =>
      list.getEntries().forEach((entry) => long.push(entry.duration)),
    );
    observer.observe({ type: "longtask", buffered: false });
    const el = [...document.querySelectorAll<HTMLElement>(".opr-pdf")].filter(
      (e) => e.scrollHeight > e.clientHeight,
    )[0];
    const frames: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 120; i++) {
      el.scrollTop += 60;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    await new Promise((r) => setTimeout(r, 300));
    observer.disconnect();
    frames.sort((a, b) => a - b);
    return {
      median: +frames[60].toFixed(1),
      p95: +frames[114].toFixed(1),
      max: +frames[119].toFixed(1),
      longTasks: long.length,
      longTotal: Math.round(long.reduce((a, b) => a + b, 0)),
    };
  });
}

test("scroll cost of the three reading modes", async ({ page }) => {
  test.skip(!process.env.PERF, "a measurement, run with PERF=1");
  test.setTimeout(240000);
  const paper = await setup(page);
  await page.goto(`/#read/${paper.paperId}`);
  await expect(page.locator('[data-page="1"]').first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const out: Record<string, unknown> = {};
  await page.waitForTimeout(2500);
  out["原文"] = await measure(page);
  for (const mode of ["对照", "译文"]) {
    await page
      .getByRole("radiogroup", { name: "阅读方式", exact: true })
      .getByRole("radio", { name: mode, exact: true })
      .click();
    await page.waitForTimeout(4000);
    await page.evaluate(() =>
      document.querySelectorAll(".opr-pdf").forEach((e) => (e.scrollTop = 0)),
    );
    await page.waitForTimeout(1500);
    out[mode] = await measure(page);
  }
  console.log("PERF " + JSON.stringify(out));
});
