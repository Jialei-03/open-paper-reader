import { test, expect } from "@playwright/test";
import { openReaderTool } from "./helpers";
import { testPdf } from "./fixtures/pdf";
test("Paper sharing: explicit publication, anonymous snapshot and revocation", async ({
  page,
  browser,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const response = await page.request.post("/api/v1/papers", {
    headers,
    data: { title: "Shared paper fixture" },
  });
  expect(response.ok()).toBeTruthy();
  const paper = await response.json();
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "shared.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  await page.goto(`/#paper/${paper.id}`);
  await openReaderTool(page, "分享论文");
  const dialog = page.getByRole("dialog", { name: "分享论文" });
  await expect(dialog.getByRole("textbox", { name: "分享链接" })).toHaveCount(
    0,
  );
  await dialog
    .getByRole("button", { name: "创建分享链接", exact: true })
    .click();
  const link = dialog.getByRole("textbox", { name: "分享链接" });
  await expect(link).toHaveValue(/#shared\/[A-Za-z0-9_-]{43}$/);
  const hash = new URL(await link.inputValue()).hash;
  const anon = await browser.newContext();
  try {
    const publicPage = await anon.newPage();
    await publicPage.goto(new URL(hash, page.url()).href);
    await expect(
      publicPage.getByRole("heading", { name: "Shared paper fixture" }),
    ).toBeVisible();
    await expect(
      publicPage.getByText("只读分享", { exact: true }),
    ).toBeVisible();
    await expect(publicPage.getByLabel("用户名")).toHaveCount(0);
    await expect(publicPage.locator("canvas").first()).toHaveAttribute(
      "width",
      /[1-9][0-9]+/,
    );
    await expect(publicPage.locator(".textLayer").first()).toContainText(
      "Searchable",
    );
    const firstPage = publicPage.getByLabel("第 1 页", { exact: true });
    await expect
      .poll(() =>
        firstPage
          .locator(".textLayer")
          .evaluate((element) =>
            Number(
              getComputedStyle(element).getPropertyValue(
                "--total-scale-factor",
              ),
            ),
          ),
      )
      .toBeGreaterThan(0);
    // Zoom uses a bounded bitmap while the selectable text tracks page geometry.
    for (let i = 0; i < 8; i++)
      await publicPage
        .getByRole("button", { name: "放大 PDF", exact: true })
        .click();
    await expect(firstPage.locator(".textLayer")).toContainText("Searchable");
    await expect
      .poll(() =>
        firstPage
          .locator("canvas")
          .evaluate((canvas) => canvas.width * canvas.height),
      )
      .toBeLessThanOrEqual(16_000_000);
    await expect
      .poll(() =>
        firstPage.evaluate((element) => {
          const pageBox = element.getBoundingClientRect(),
            text = element.querySelector(".textLayer")!.getBoundingClientRect();
          return (
            Math.abs(pageBox.width - text.width) < 2 &&
            Math.abs(pageBox.height - text.height) < 2
          );
        }),
      )
      .toBe(true);
    const scroll = publicPage
      .getByRole("region", { name: "分享 PDF" })
      .locator(".overflow-auto");
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(firstPage.locator("canvas")).toHaveCount(0);
    await expect(firstPage.locator(".textLayer")).toHaveCount(0);
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(firstPage.locator("canvas")).toBeVisible();
    await expect(firstPage.locator(".textLayer")).toContainText("Searchable");
    await publicPage.getByRole("button", { name: "300%", exact: true }).click();
    await publicPage.screenshot({ path: "../test-results/paper-sharing.png" });
    const token = hash.slice(8);
    expect(
      (
        await publicPage.request.get(
          new URL(`/api/v1/shared/${token}/pdf`, page.url()).href,
        )
      ).status(),
    ).toBe(200);
    await dialog.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(dialog.getByText("已撤销", { exact: true })).toBeVisible();
    await publicPage.reload();
    await expect(publicPage.getByRole("alert")).toContainText(
      "分享不存在或已失效",
    );
  } finally {
    await anon.close();
  }
});
