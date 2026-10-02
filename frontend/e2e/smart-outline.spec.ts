import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";
import { cancelActiveRuns } from "./helpers";
test("missing native outline: explicit generation, cancellation and persistence", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "最近", exact: true }),
  ).toBeVisible();
  await cancelActiveRuns(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post("/api/v1" + path, {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      data,
    });
    expect(r.ok()).toBeTruthy();
    return r.json();
  };
  const paper = await post("/papers", { title: "Outline persistence" });
  const file = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "outline.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(file.ok()).toBeTruthy();
  await post("/translation-settings/configs", {
    base_url: "https://api.minimax.cn/v1",
    model: "MiniMax-M3",
    name: "Outline fixture",
    protocol: "openai",
    api_key: "synthetic-e2e-key",
  });
  await page.goto("/#paper/" + paper.id);
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  const outline = page.getByLabel("智能目录", { exact: true });
  await expect(outline).toBeVisible();
  await expect(
    outline.getByRole("button", { name: "生成智能目录", exact: true }),
  ).toBeEnabled();
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && r.url().endsWith("/reading-artifacts"),
  );
  await outline
    .getByRole("button", { name: "生成智能目录", exact: true })
    .click();
  const row = await (await response).json();
  expect(row.kind).toBe("outline");
  expect(row.status).toBe("queued");
  await expect(
    outline.getByRole("button", { name: "生成中 · 停止", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "论文目录", exact: true }).click();
  await expect(
    outline.getByRole("button", { name: "生成中 · 停止", exact: true }),
  ).toBeVisible();
  await outline
    .getByRole("button", { name: "生成中 · 停止", exact: true })
    .click();
  await expect(
    outline.getByRole("button", { name: "生成智能目录", exact: true }),
  ).toBeEnabled();
  const saved = await (
    await page.request.get("/api/v1/reading-artifacts/" + row.id)
  ).json();
  expect(saved.status).toBe("cancelled");
});
