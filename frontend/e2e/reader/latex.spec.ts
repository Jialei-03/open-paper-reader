import { expect, test, type Page } from "@playwright/test";
import {
  createPaperWithPdf,
  openReader,
  pdfWithPages,
  signIn,
} from "./fixtures";

// 译文 for an arXiv paper: translated from its LaTeX source and compiled again
// (engine "latex"), else re-typeset on the original PDF (engine "pdf"). The jobs
// and the settings are mocked; the translating itself is the service's
// (backend/tests/test_translation.py, backend/tests/test_latex_install.py).
test.use({ locale: "zh-CN" });

type Row = Record<string, unknown>;

type Service = {
  /** `latex_translation_available`, `latex_installable` and `pdf_layout_enabled` of the settings. */
  latex: boolean;
  installable: boolean;
  layout: boolean;
  jobs: Row[];
  started: Row[];
  cancelled: string[];
  /** The local build's Tectonic install, as `GET /latex-install` says it. */
  install: Row;
  installCalls: string[];
};

type Paper = {
  paperId: string;
  fileId: string;
  versionId: string;
};

/** A paper with a PDF; with an arXiv id of a fixed version when `arxiv` is given. */
async function makePaper(page: Page, arxiv = ""): Promise<Paper> {
  const { paperId, fileId } = await createPaperWithPdf(page, { pages: 3 });
  let paper = await (
    await page.request.get(`/api/v1/papers/${paperId}`)
  ).json();
  if (arxiv) {
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "paper_csrf",
    )!.value;
    const patched = await page.request.patch(`/api/v1/papers/${paperId}`, {
      headers: {
        "X-CSRF-Token": csrf,
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": String(paper.revision),
      },
      data: { external_id: arxiv },
    });
    expect(patched.ok()).toBeTruthy();
    paper = await patched.json();
  }
  return { paperId, fileId, versionId: paper.current_version };
}

async function serve(
  page: Page,
  paper: Paper,
  start: Partial<Service> = {},
): Promise<Service> {
  const service: Service = {
    latex: true,
    installable: false,
    layout: true,
    jobs: [],
    started: [],
    cancelled: [],
    install: {
      status: "idle",
      stage: "",
      progress: 0,
      error: "",
      supported: true,
      installed: false,
      available: false,
    },
    installCalls: [],
    ...start,
  };
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        models: [{ id: "model-1", name: "Fixture model", model: "fixture" }],
        active_id: "model-1",
        configured: true,
        pdf_layout_enabled: service.layout,
        latex_translation_available: service.latex,
        latex_installable: service.installable,
      },
    }),
  );
  await page.route(
    `**/api/v1/papers/${paper.paperId}/translations`,
    (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({ json: service.jobs });
      const body = route.request().postDataJSON() as Row;
      service.started.push(body);
      const created: Row = {
        id: `job-${service.started.length}`,
        engine: body.engine,
        version_id: paper.versionId,
        status: "queued",
        stage: "",
        completed: 0,
        total: body.engine === "pdf" ? 100 : 0,
        error: "",
        no_source: false,
        source_file: body.engine === "pdf" ? paper.fileId : "",
        translated_file: "",
      };
      service.jobs.unshift(created);
      return route.fulfill({ json: created });
    },
  );
  await page.route("**/api/v1/translations/*/cancel", (route) => {
    const id = route.request().url().split("/").at(-2)!;
    service.cancelled.push(id);
    const stopped = service.jobs.find((row) => row.id === id);
    if (stopped) Object.assign(stopped, { status: "cancelled", stage: "" });
    return route.fulfill({ json: stopped ?? {} });
  });
  await page.route("**/api/v1/latex-install**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      service.installCalls.push(path);
      Object.assign(service.install, {
        status: "running",
        stage: "download",
        progress: 20,
      });
    }
    return route.fulfill({ json: service.install });
  });
  return service;
}

const main = (page: Page) => page.getByRole("main");
const panel = (page: Page) =>
  main(page).getByRole("region", { name: "版面翻译", exact: true });
const translated = (page: Page) =>
  main(page)
    .getByRole("radiogroup", { name: "阅读方式", exact: true })
    .getByRole("radio", { name: "译文", exact: true });

async function open(page: Page, paper: Paper) {
  await openReader(page, { paperId: paper.paperId });
  await expect(page.locator('[data-page="1"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await translated(page).click();
  await expect(panel(page)).toBeVisible();
}

test("an arXiv paper is translated from its LaTeX source, and the job is followed and can be stopped", async ({
  page,
}) => {
  await signIn(page);
  const paper = await makePaper(page, "arxiv:2504.19413v1");
  const service = await serve(page, paper);
  await open(page, paper);

  await expect(panel(page).getByText("从 arXiv 源码翻译并编译")).toBeVisible();
  await expect(panel(page).getByText("在原 PDF 上重新排版")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "开始翻译" }).click();
  await expect
    .poll(() => service.started)
    .toEqual([{ model_config_id: "model-1", engine: "latex" }]);

  // The service's stages and counts, as the job reports them.
  Object.assign(service.jobs[0], {
    status: "running",
    stage: "翻译章节与公式",
    completed: 3,
    total: 10,
  });
  await expect(panel(page).getByText("翻译章节与公式")).toBeVisible();
  await expect(
    panel(page).getByRole("progressbar", { name: "翻译进度" }),
  ).toHaveAttribute("aria-valuenow", "30");
  await expect(panel(page).getByText("从 arXiv 源码翻译并编译")).toBeVisible();

  await panel(page).getByRole("button", { name: "取消翻译" }).click();
  await expect.poll(() => service.cancelled).toEqual(["job-1"]);
  await expect(
    panel(page).getByRole("button", { name: "开始翻译" }),
  ).toBeVisible();
});

test("a paper that is not from arXiv is re-typeset on its PDF", async ({
  page,
}) => {
  await signIn(page);
  const paper = await makePaper(page);
  const service = await serve(page, paper);
  await open(page, paper);

  await expect(panel(page).getByText("在原 PDF 上重新排版")).toBeVisible();
  await expect(panel(page).getByText("从 arXiv 源码翻译并编译")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "开始版面翻译" }).click();
  await expect
    .poll(() => service.started)
    .toEqual([
      {
        model_config_id: "model-1",
        engine: "pdf",
        source_file_id: paper.fileId,
      },
    ]);
});

test("an arXiv version without LaTeX source offers the PDF way, which starts a layout translation", async ({
  page,
}) => {
  await signIn(page);
  const paper = await makePaper(page, "arxiv:2504.19413v1");
  const service = await serve(page, paper, {
    jobs: [
      {
        id: "job-0",
        engine: "latex",
        version_id: paper.versionId,
        status: "failed",
        stage: "翻译未完成",
        completed: 0,
        total: 0,
        error: "该版本未提供可用的 LaTeX 源码",
        no_source: true,
        source_file: paper.fileId,
        translated_file: "",
      },
    ],
  });
  await open(page, paper);

  await expect(
    panel(page).getByRole("heading", {
      name: "arXiv 没有这个版本的 LaTeX 源码。",
    }),
  ).toBeVisible();
  // Trying the source again cannot help: only the PDF way is offered.
  await expect(panel(page).getByRole("button", { name: "重试" })).toHaveCount(
    0,
  );
  await panel(page)
    .getByRole("button", { name: "改为在原 PDF 上排版" })
    .click();
  await expect
    .poll(() => service.started)
    .toEqual([
      {
        model_config_id: "model-1",
        engine: "pdf",
        source_file_id: paper.fileId,
      },
    ]);
  await expect(
    panel(page).getByRole("progressbar", { name: "翻译进度" }),
  ).toBeVisible();
  await expect(panel(page).getByText("在原 PDF 上重新排版")).toBeVisible();
});

test("another LaTeX failure can be tried again, or re-typeset on the PDF", async ({
  page,
}) => {
  await signIn(page);
  const paper = await makePaper(page, "arxiv:2504.19413v1");
  const service = await serve(page, paper, {
    jobs: [
      {
        id: "job-0",
        engine: "latex",
        version_id: paper.versionId,
        status: "failed",
        stage: "中文 PDF 编译失败",
        completed: 10,
        total: 10,
        error: "中文 PDF 编译失败：宏包或排版编译失败",
        no_source: false,
        source_file: paper.fileId,
        translated_file: "",
      },
    ],
  });
  await open(page, paper);

  await expect(
    panel(page).getByText("中文 PDF 编译失败：宏包或排版编译失败"),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "改为在原 PDF 上排版" }),
  ).toBeVisible();
  await panel(page).getByRole("button", { name: "重试" }).click();
  await expect
    .poll(() => service.started)
    .toEqual([{ model_config_id: "model-1", engine: "latex" }]);
});

test("a finished LaTeX translation is read in the engine", async ({ page }) => {
  await signIn(page);
  const paper = await makePaper(page, "arxiv:2504.19413v1");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const upload = await page.request.post(
    `/api/v1/papers/${paper.paperId}/files`,
    {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        version_id: paper.versionId,
        file: {
          name: "zh-2504.19413v1.pdf",
          mimeType: "application/pdf",
          buffer: pdfWithPages(3, [], { words: { 1: "Compiled copy" } }),
        },
      },
    },
  );
  expect(upload.ok()).toBeTruthy();
  const translatedId = (await upload.json()).id;
  await serve(page, paper, {
    jobs: [
      {
        id: "job-0",
        engine: "latex",
        version_id: paper.versionId,
        status: "completed",
        stage: "翻译完成",
        completed: 10,
        total: 10,
        error: "",
        no_source: false,
        source_file: paper.fileId,
        translated_file: translatedId,
      },
    ],
  });
  await openReader(page, { paperId: paper.paperId });
  await translated(page).click();
  await expect(
    page.getByRole("region", { name: "论文页面", exact: true }),
  ).toHaveAttribute("data-file", translatedId);
  await expect(panel(page)).toHaveCount(0);
});

test("in the local build without the TeX engine, an arXiv paper offers to install it and then uses it", async ({
  page,
}) => {
  await signIn(page);
  const paper = await makePaper(page, "arxiv:2504.19413v1");
  const service = await serve(page, paper, { latex: false, installable: true });
  await open(page, paper);

  // Meanwhile the PDF way is what it would use.
  await expect(panel(page).getByText("在原 PDF 上重新排版")).toBeVisible();
  await panel(page).getByRole("button", { name: "安装 LaTeX 编译器" }).click();
  await expect
    .poll(() => service.installCalls)
    .toEqual(["/api/v1/latex-install"]);
  await expect(
    panel(page).getByRole("progressbar", { name: "安装进度" }),
  ).toBeVisible();

  // Installed: the settings say so, and the source way is the one offered.
  Object.assign(service.install, {
    status: "completed",
    stage: "",
    progress: 100,
    installed: true,
    available: true,
  });
  Object.assign(service, { latex: true, installable: false });
  await expect(panel(page).getByText("从 arXiv 源码翻译并编译")).toBeVisible();
  await panel(page).getByRole("button", { name: "开始翻译" }).click();
  await expect
    .poll(() => service.started)
    .toEqual([{ model_config_id: "model-1", engine: "latex" }]);
});

test("without any way to compile or re-typeset, the local build offers the LaTeX compiler", async ({
  page,
}) => {
  await signIn(page);
  const paper = await makePaper(page, "arxiv:2504.19413v1");
  await serve(page, paper, { latex: false, installable: true, layout: false });
  await open(page, paper);

  await expect(
    panel(page).getByRole("heading", { name: "还没有安装 LaTeX 编译器" }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: "安装 LaTeX 编译器" }),
  ).toBeVisible();
});
