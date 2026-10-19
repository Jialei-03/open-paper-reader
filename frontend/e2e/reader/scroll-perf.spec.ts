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

/** Long tasks and the worst frame while `act` runs (on the page), after it settles. */
async function jank(page: Page, act: "collapse" | "scroll") {
  await page.evaluate(() => {
    const w = window as unknown as {
      __long: number[];
      __frames: number[];
      __stop: boolean;
    };
    w.__long = [];
    w.__frames = [];
    w.__stop = false;
    new PerformanceObserver((list) =>
      list.getEntries().forEach((entry) => w.__long.push(entry.duration)),
    ).observe({ type: "longtask", buffered: false });
    (w as unknown as { __loaf: unknown[] }).__loaf = [];
    try {
      new PerformanceObserver((list) =>
        list.getEntries().forEach((entry) => {
          const e = entry as unknown as {
            duration: number;
            blockingDuration: number;
            renderStart: number;
            styleAndLayoutStart: number;
            startTime: number;
            scripts: {
              duration: number;
              invoker: string;
              sourceFunctionName: string;
            }[];
          };
          (w as unknown as { __loaf: unknown[] }).__loaf.push({
            d: Math.round(e.duration),
            script: Math.round(e.scripts.reduce((a, x) => a + x.duration, 0)),
            layout: Math.round(
              e.startTime + e.duration - e.styleAndLayoutStart,
            ),
            top: e.scripts
              .sort((a, b) => b.duration - a.duration)
              .slice(0, 2)
              .map(
                (x) =>
                  `${Math.round(x.duration)} ${x.invoker} ${x.sourceFunctionName}`,
              ),
          });
        }),
      ).observe({ type: "long-animation-frame", buffered: false });
    } catch {}
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      w.__frames.push(now - last);
      last = now;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (act === "collapse") {
    await page.getByRole("button", { name: "收起右侧面板" }).click();
  } else {
    await page.evaluate(async () => {
      const el = [...document.querySelectorAll<HTMLElement>(".opr-pdf")].filter(
        (e) => e.scrollHeight > e.clientHeight,
      )[0];
      for (let i = 0; i < 80; i++) {
        el.scrollTop += 60;
        await new Promise((r) => requestAnimationFrame(r));
      }
    });
  }
  await page.waitForTimeout(1500);
  if (process.env.PROFILE)
    console.log(
      "LOAF " +
        JSON.stringify(
          await page.evaluate(
            () => (window as unknown as { __loaf: unknown[] }).__loaf,
          ),
        ),
    );
  return page.evaluate(() => {
    const w = window as unknown as {
      __long: number[];
      __frames: number[];
      __stop: boolean;
    };
    w.__stop = true;
    return {
      longTasks: w.__long.length,
      longest: Math.round(Math.max(0, ...w.__long)),
      longTotal: Math.round(w.__long.reduce((a, b) => a + b, 0)),
      worstFrame: Math.round(Math.max(...w.__frames)),
    };
  });
}

test("译文 jank under a 4x slower CPU", async ({ page }) => {
  test.skip(!process.env.PERF, "a measurement, run with PERF=1");
  test.setTimeout(240000);
  const paper = await setup(page);
  await page.goto(`/#read/${paper.paperId}`);
  await expect(page.locator('[data-page="1"]').first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page
    .getByRole("radiogroup", { name: "阅读方式", exact: true })
    .getByRole("radio", { name: "译文", exact: true })
    .click();
  await page.waitForTimeout(4000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: Number(process.env.CPU || 4),
  });
  const out: Record<string, unknown> = {};
  out.collapse = await jank(page, "collapse");
  await page.getByRole("button", { name: "展开右侧面板" }).click();
  await page.waitForTimeout(2500);
  out.expand = await jank(page, "collapse").catch(() => null);
  await page.waitForTimeout(1500);
  out.scroll = await jank(page, "scroll");
  console.log("JANK " + JSON.stringify(out));
});

test("译文 scroll profile", async ({ page }) => {
  test.skip(!process.env.PROFILE, "a profile, run with PROFILE=1");
  test.setTimeout(240000);
  await page.addInitScript(() => {
    const w = window as unknown as { __mt: { n: number; ms: number } };
    w.__mt = { n: 0, ms: 0 };
    const original = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (text: string) {
      const t = performance.now();
      const r = original.call(this, text);
      w.__mt.n++;
      w.__mt.ms += performance.now() - t;
      const log = ((w as any).__log ??= [] as string[]);
      if (performance.now() - t > 5)
        log.push(
          `${(performance.now() - t).toFixed(1)}ms ${this.font} len=${text.length} dom=${document.getElementsByTagName("*").length}`,
        );
      return r;
    };
  });
  const paper = await setup(page);
  await page.goto(`/#read/${paper.paperId}`);
  await expect(page.locator('[data-page="1"]').first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page
    .getByRole("radiogroup", { name: "阅读方式", exact: true })
    .getByRole("radio", { name: "译文", exact: true })
    .click();
  await page.waitForTimeout(4000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", {
    rate: Number(process.env.CPU || 4),
  });
  await page.evaluate(() => {
    (window as unknown as { __mt: { n: number; ms: number } }).__mt = {
      n: 0,
      ms: 0,
    };
  });
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  await jank(page, "scroll");
  console.log(
    "LOG " + JSON.stringify(await page.evaluate(() => (window as any).__log)),
  );
  console.log(
    "MT " +
      JSON.stringify(
        await page.evaluate(
          () => (window as unknown as { __mt: unknown }).__mt,
        ),
      ),
  );
  const { profile } = (await cdp.send("Profiler.stop")) as {
    profile: {
      nodes: {
        id: number;
        callFrame: { functionName: string; url: string; lineNumber: number };
        children?: number[];
      }[];
      samples: number[];
      timeDeltas: number[];
    };
  };
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) =>
    self.set(id, (self.get(id) ?? 0) + profile.timeDeltas[i]),
  );
  const byName = new Map<string, number>();
  for (const node of profile.nodes) {
    const key = `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()}:${node.callFrame.lineNumber}`;
    byName.set(key, (byName.get(key) ?? 0) + (self.get(node.id) ?? 0));
  }
  const parent = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node.id);
  const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
  const chains = new Map<string, number>();
  for (const node of profile.nodes) {
    if (node.callFrame.functionName !== "measureText") continue;
    const names: string[] = [];
    for (
      let id = parent.get(node.id);
      id && names.length < 5;
      id = parent.get(id)
    )
      names.push(nodeById.get(id)!.callFrame.functionName || "anon");
    const key = names.join(" < ");
    chains.set(key, (chains.get(key) ?? 0) + (self.get(node.id) ?? 0));
  }
  console.log(
    "CHAINS\n" +
      [...chains]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`)
        .join("\n"),
  );
  const classOf = (id: number): string => {
    for (let cur: number | undefined = id; cur; cur = parent.get(cur)) {
      const f = nodeById.get(cur)!.callFrame.functionName;
      if (f === "ru" || f === "Lp") return "text";
      if (f === "executeOperatorList" || f === "_next") return "canvas";
      if (f === "visible" || f === "distance" || f === "metrics")
        return "rects";
      if (f === "(idle)") return "idle";
    }
    return "other";
  };
  const segs: { ms: number; by: Record<string, number> }[] = [];
  let cur: { ms: number; by: Record<string, number> } | null = null;
  profile.samples.forEach((id, i) => {
    const c = classOf(id);
    const dt = profile.timeDeltas[i] / 1000;
    if (c === "idle") {
      if (cur) segs.push(cur);
      cur = null;
      return;
    }
    cur ??= { ms: 0, by: {} };
    cur.ms += dt;
    cur.by[c] = (cur.by[c] ?? 0) + dt;
  });
  console.log(
    "SEGS\n" +
      segs
        .filter((x) => x.ms > 80)
        .map(
          (x) =>
            `${Math.round(x.ms)} ${JSON.stringify(Object.fromEntries(Object.entries(x.by).map(([k, v]) => [k, Math.round(v)])))}`,
        )
        .join("\n"),
  );
  const total = new Map<number, number>();
  const inclusive = (id: number): number => {
    if (total.has(id)) return total.get(id)!;
    let sum = self.get(id) ?? 0;
    for (const child of nodeById.get(id)!.children ?? [])
      sum += inclusive(child);
    total.set(id, sum);
    return sum;
  };
  const incl = new Map<string, number>();
  for (const node of profile.nodes) {
    const key = `${node.callFrame.functionName || "(anon)"} ${node.callFrame.url.split("/").pop()}`;
    incl.set(key, (incl.get(key) ?? 0) + inclusive(node.id));
  }
  console.log(
    "INCL\n" +
      [...incl]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`)
        .join("\n"),
  );
  const top = [...byName].sort((a, b) => b[1] - a[1]).slice(0, 14);
  console.log(
    "PROFILE\n" +
      top.map(([k, v]) => `${Math.round(v / 1000)}ms ${k}`).join("\n"),
  );
});
