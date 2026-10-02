import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { testPdf } from "./fixtures/pdf";

test("Library selections download original PDFs and explicitly confirm partially available translations", async ({
  page,
}, info) => {
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
  for (const title of ["Download Alpha", "Download Beta"]) {
    const response = await page.request.post("/api/v1/papers", {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      data: { title, tags: ["download-fixture"] },
    });
    expect(response.ok()).toBeTruthy();
    const paper = await response.json();
    ids.push(paper.id);
    const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
      headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
      multipart: {
        version_id: paper.current_version,
        file: {
          name: "source.pdf",
          mimeType: "application/pdf",
          buffer: testPdf(),
        },
      },
    });
    expect(upload.ok()).toBeTruthy();
  }
  await page.goto("/#library?tag=download-fixture");
  await expect(
    page.getByRole("table", { name: "论文列表" }).getByRole("row"),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "批量管理", exact: true }).click();
  await page.getByRole("checkbox", { name: "选择当前页论文" }).check();
  const toolbar = page.getByRole("toolbar", { name: "批量管理论文" });
  const originalDownload = page.waitForEvent("download");
  await toolbar.getByRole("button", { name: "下载原文", exact: true }).click();
  const original = await originalDownload;
  expect(original.suggestedFilename()).toBe("原文-2篇.zip");
  const path = info.outputPath("originals.zip");
  await original.saveAs(path);
  const entries = JSON.parse(
    execFileSync(
      "../.venv/bin/python",
      [
        "-c",
        "import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([{'name':n,'pdf':z.read(n).startswith(b'%PDF-')} for n in z.namelist()]))",
        path,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(entries).toHaveLength(2);
  expect(
    entries.every(
      (entry: { name: string; pdf: boolean }) =>
        entry.pdf && entry.name.endsWith("原文.pdf"),
    ),
  ).toBe(true);
  await toolbar.getByRole("button", { name: "下载译文", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "确认批量下载" });
  await expect(confirmation).toContainText("0 篇可下载");
  await expect(confirmation).toContainText("Download Alpha");
  await expect(confirmation).toContainText("Download Beta");
  await expect(
    confirmation.getByRole("button", { name: "下载可用译文" }),
  ).toBeDisabled();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  // Only the UI contract is stubbed here; backend tests verify real translated bytes.
  await page.route("**/api/v1/paper-downloads/plan?**", (route) =>
    route.fulfill({
      json: {
        papers: 1,
        files: 1,
        total_size: 1000,
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
  const translatedZip = execFileSync("../.venv/bin/python", [
    "-c",
    "import io,zipfile,base64,sys; b=io.BytesIO(); z=zipfile.ZipFile(b,'w'); z.writestr('Download Alpha/译文.pdf',base64.b64decode(sys.argv[1])); z.close(); sys.stdout.buffer.write(b.getvalue())",
    testPdf().toString("base64"),
  ]);
  await page.route("**/api/v1/paper-downloads/archive?**", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("mode")).toBe("translated");
    expect(new Set(url.searchParams.get("ids")!.split(","))).toEqual(
      new Set(ids),
    );
    return route.fulfill({
      body: translatedZip,
      contentType: "application/zip",
    });
  });
  await toolbar.getByRole("button", { name: "下载译文", exact: true }).click();
  await expect(confirmation).toContainText("1 篇可下载");
  const translatedDownload = page.waitForEvent("download");
  await confirmation.getByRole("button", { name: "下载可用译文" }).click();
  expect((await translatedDownload).suggestedFilename()).toBe("译文-1篇.zip");
  await expect(confirmation).toBeHidden();
  await expect(toolbar.getByRole("status")).toHaveText("已选 2 篇");
});
