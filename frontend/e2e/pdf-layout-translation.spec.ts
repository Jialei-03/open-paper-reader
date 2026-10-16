import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";
import { openLayoutTranslation } from "./helpers";

test("ordinary PDF translation selects an attachment and sends a real owned job", async ({
  page,
}) => {
  test.skip(
    !process.env.PDF_LAYOUT_IMAGE,
    "Requires the isolated PDF-layout control-plane fixture",
  );
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "paper_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf };
  const paperResponse = await page.request.post("/api/v1/papers", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { title: "Ordinary PDF translation acceptance" },
  });
  expect(paperResponse.ok()).toBeTruthy();
  const paper = await paperResponse.json();
  const model = await page.request.put("/api/v1/translation-settings", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      base_url: "https://api.openai.com/v1",
      model: "workflow-fixture",
      api_key: "fake-workflow-key",
    },
  });
  expect(model.ok()).toBeTruthy();
  const uploads = [];
  for (const name of ["first.pdf", "chosen.pdf"]) {
    const response = await page.request.post(
      `/api/v1/papers/${paper.id}/files`,
      {
        headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        multipart: {
          version_id: paper.current_version,
          file: { name, mimeType: "application/pdf", buffer: testPdf() },
        },
      },
    );
    expect(response.ok()).toBeTruthy();
    uploads.push(await response.json());
  }
  await page.goto(`/#paper/${paper.id}`);
  await openLayoutTranslation(page);
  await expect(page.getByRole("radio", { name: "PDF 版面" })).toBeVisible();
  await expect(page.getByText("arXiv 源码", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "原始 PDF" }).click();
  await page.getByRole("option", { name: "chosen.pdf" }).click();
  const sent = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/papers/${paper.id}/translations`) &&
      request.method() === "POST",
  );
  await page.getByRole("button", { name: "翻译成中文", exact: true }).click();
  const request = await sent;
  expect(request.postDataJSON()).toMatchObject({
    engine: "pdf",
    source_file_id: uploads[1].id,
  });
  const response = await page.request.get(
    `/api/v1/papers/${paper.id}/translations`,
  );
  const jobs = await response.json();
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    engine: "pdf",
    source_file: uploads[1].id,
    status: "queued",
  });
  await expect(page.getByRole("button", { name: "取消翻译" })).toBeVisible();
  await page.getByRole("button", { name: "取消翻译" }).click();
  await expect(
    page.getByRole("button", { name: "翻译成中文", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "../test-results/pdf-layout-translation-controls.png",
  });
});
