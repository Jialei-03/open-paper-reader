import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { testPdf } from "./fixtures/pdf";

for (const mobile of [false, true]) {
  test(`Library saves separate PDFs and confirms missing translations (${mobile ? "iPad" : "desktop"})`, async ({
    page,
  }, info) => {
    if (mobile)
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
        Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
        (window as any).shared = [];
        Object.defineProperty(navigator, "canShare", {
          value: (data: ShareData) => !!data.files?.length,
        });
        Object.defineProperty(navigator, "share", {
          value: (data: ShareData) => {
            (window as any).shared.push(data.files);
            return Promise.resolve();
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
    const ids: string[] = [];
    const fileIds: string[] = [];
    for (const title of ["Download Alpha", "Download Beta"]) {
      const response = await page.request.post("/api/v1/papers", {
        headers: {
          "X-CSRF-Token": csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: { title, tags: [`download-fixture-${mobile}`] },
      });
      expect(response.ok()).toBeTruthy();
      const paper = await response.json();
      ids.push(paper.id);
      const upload = await page.request.post(
        `/api/v1/papers/${paper.id}/files`,
        {
          headers: {
            "X-CSRF-Token": csrf,
            "Idempotency-Key": crypto.randomUUID(),
          },
          multipart: {
            version_id: paper.current_version,
            file: {
              name: "source.pdf",
              mimeType: "application/pdf",
              buffer: testPdf(),
            },
          },
        },
      );
      expect(upload.ok()).toBeTruthy();
      fileIds.push((await upload.json()).id);
    }
    await page.goto(`/#library?tag=download-fixture-${mobile}`);
    await expect(
      page.getByRole("table", { name: "论文列表" }).getByRole("row"),
    ).toHaveCount(3);
    await page.getByRole("button", { name: "批量管理", exact: true }).click();
    await page.getByRole("checkbox", { name: "选择当前页论文" }).check();
    const toolbar = page.getByRole("toolbar", { name: "批量管理论文" });
    const downloads: import("@playwright/test").Download[] = [];
    page.on("download", (file) => downloads.push(file));
    await toolbar
      .getByRole("button", { name: "下载原文", exact: true })
      .click();
    if (mobile) {
      const save = page.getByRole("dialog", { name: "保存文件", exact: true });
      await expect(save).toContainText("2 个 PDF");
      await save
        .getByRole("button", { name: "保存到文件", exact: true })
        .click();
      const shared = await page.evaluate(async () =>
        Promise.all(
          (window as any).shared[0].map(async (file: File) => ({
            name: file.name,
            type: file.type,
            bytes: [...new Uint8Array(await file.arrayBuffer())],
          })),
        ),
      );
      expect(shared).toHaveLength(2);
      for (const file of shared) {
        expect(file.name).toMatch(/原文\.pdf$/);
        expect(file.type).toBe("application/pdf");
        expect(file.bytes).toEqual([...testPdf()]);
      }
    } else {
      await expect.poll(() => downloads.length).toBe(2);
      for (const [index, file] of downloads.entries()) {
        expect(file.suggestedFilename()).toMatch(/原文\.pdf$/);
        const path = info.outputPath(`original-${index}.pdf`);
        await file.saveAs(path);
        expect(readFileSync(path)).toEqual(testPdf());
      }
    }
    await toolbar
      .getByRole("button", { name: "下载译文", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", { name: "确认批量下载" });
    await expect(confirmation).toContainText("0 篇可下载");
    await expect(confirmation).toContainText("Download Alpha");
    await expect(confirmation).toContainText("Download Beta");
    await expect(
      confirmation.getByRole("button", { name: "下载可用译文" }),
    ).toBeDisabled();
    await confirmation
      .getByRole("button", { name: "取消", exact: true })
      .click();
    // Only the UI contract is stubbed here; backend tests verify real translated bytes.
    await page.route("**/api/v1/paper-downloads/plan?**", (route) =>
      route.fulfill({
        json: {
          papers: 1,
          files: 1,
          total_size: 1000,
          downloads: [
            {
              name: "Download Alpha-译文.pdf",
              url: `/api/v1/files/${fileIds[0]}/content?download=true`,
              size: 1000,
            },
          ],
          missing: [
            {
              paper_id: ids[1],
              title: "Download Beta",
              reason: "当前版本尚无已完成的译文 PDF",
            },
          ],
        },
      }),
    );
    await page.route(
      `**/api/v1/files/${fileIds[0]}/content?download=true`,
      (route) =>
        route.fulfill({ body: testPdf(), contentType: "application/pdf" }),
    );
    await toolbar
      .getByRole("button", { name: "下载译文", exact: true })
      .click();
    await expect(confirmation).toContainText("1 篇可下载");
    const before = downloads.length;
    await confirmation.getByRole("button", { name: "下载可用译文" }).click();
    if (mobile) {
      const save = page.getByRole("dialog", { name: "保存文件", exact: true });
      await expect(save).toContainText("Download Alpha-译文.pdf");
      await save
        .getByRole("button", { name: "保存到文件", exact: true })
        .click();
      expect(await page.evaluate(() => (window as any).shared[1].length)).toBe(
        1,
      );
    } else {
      await expect.poll(() => downloads.length).toBe(before + 1);
      expect(downloads[before].suggestedFilename()).toBe(
        "Download Alpha-译文.pdf",
      );
    }
    await expect(confirmation).toBeHidden();
    await expect(toolbar.getByRole("status")).toHaveText("已选 2 篇");
  });
}
