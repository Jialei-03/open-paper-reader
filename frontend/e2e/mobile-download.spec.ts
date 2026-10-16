import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";

test("Installed iPad-style app saves actual PDF bytes without navigating and allows share cancellation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
    Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
    (window as any).savedFiles = [];
    (window as any).saveGestures = [];
    Object.defineProperty(navigator, "canShare", {
      value: (data: ShareData) => !!data.files?.length,
    });
    Object.defineProperty(navigator, "share", {
      value: (data: ShareData) => {
        (window as any).savedFiles.push(data.files![0]);
        (window as any).saveGestures.push(navigator.userActivation.isActive);
        return (window as any).savedFiles.length === 1
          ? Promise.reject(new DOMException("User cancelled", "AbortError"))
          : Promise.resolve();
      },
    });
  });
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "最近", exact: true }),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const created = await page.request.post("/api/v1/papers", {
    headers,
    data: { title: "移动设备下载验证" },
  });
  expect(created.ok()).toBeTruthy();
  const paper = await created.json();
  const bytes = testPdf();
  const uploaded = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: { name: "input.pdf", mimeType: "application/pdf", buffer: bytes },
    },
  });
  expect(uploaded.ok()).toBeTruthy();
  const file = await uploaded.json();
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-text-layer").first()).toContainText(
    "Evidence stays connected",
  );
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/v1/files/${file.id}/content?download=true`,
    async (route) => {
      await paused;
      await route.fulfill({
        body: bytes,
        contentType: "application/pdf",
        headers: { "Content-Length": String(bytes.length) },
      });
    },
  );
  await page.getByRole("button", { name: "下载 PDF", exact: true }).click();
  await page.getByRole("menuitem", { name: "下载原文件", exact: true }).click();
  const preparing = page.getByRole("dialog", { name: "正在准备下载" });
  await expect(preparing).toBeVisible();
  await expect(
    preparing.getByRole("progressbar", { name: "文件下载进度" }),
  ).toBeVisible();
  expect(page.url()).toContain(`/#paper/${paper.id}`);
  release();
  const ready = page.getByRole("dialog", { name: "保存文件", exact: true });
  await expect(ready).toContainText("移动设备下载验证.pdf");
  await ready.getByRole("button", { name: "保存到文件", exact: true }).click();
  await expect(
    ready.getByRole("button", { name: "保存到文件", exact: true }),
  ).toBeEnabled();
  await expect(ready.getByRole("alert")).toHaveCount(0);
  await ready.getByRole("button", { name: "保存到文件", exact: true }).click();
  await expect(ready).toBeHidden();
  const saved = await page.evaluate(async () => ({
    names: (window as any).savedFiles.map((f: File) => f.name),
    mime: (window as any).savedFiles[0].type,
    bytes: [
      ...new Uint8Array(await (window as any).savedFiles[0].arrayBuffer()),
    ],
    gestures: (window as any).saveGestures,
  }));
  expect(saved.names).toEqual(["移动设备下载验证.pdf", "移动设备下载验证.pdf"]);
  expect(saved.mime).toBe("application/pdf");
  expect(saved.bytes).toEqual([...bytes]);
  expect(saved.gestures).toEqual([true, true]);
  expect(page.url()).toContain(`/#paper/${paper.id}`);
});
