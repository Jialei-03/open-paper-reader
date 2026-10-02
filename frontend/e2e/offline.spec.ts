import { createServer, request as httpRequest } from "node:http";
import {
  test,
  expect,
  chromium,
  webkit,
  firefox,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
async function write(page: Page, path: string, data: any, revision?: number) {
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const result = await page.request.fetch("/api/v1" + path, {
    method: revision ? "PUT" : "POST",
    headers: {
      "X-CSRF-Token": csrf,
      "Idempotency-Key": crypto.randomUUID(),
      ...(revision ? { "If-Match": String(revision) } : {}),
    },
    data,
  });
  expect(result.ok(), await result.text()).toBeTruthy();
  return result.json();
}
test("Offline: browser restart retains PDF and notes, sync avoids duplicates and preserves conflicting cloud notes", async ({
  browserName,
}) => {
  test.setTimeout(180000);
  const directory = await mkdtemp(join(tmpdir(), "zhijian-offline-e2e-"));
  const engine = { chromium, webkit, firefox }[browserName];
  // WebKit's setOffline currently rejects even service-worker responses (#42775).
  // A socket-level origin outage tests the real cache path without that emulator.
  let disconnected = false;
  const proxy = createServer((req, res) => {
    if (disconnected) {
      req.socket.destroy();
      return;
    }
    const upstream = httpRequest(
      "http://127.0.0.1:8766" + req.url,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: "127.0.0.1:8766",
          ...(req.headers.origin ? { origin: "http://127.0.0.1:8766" } : {}),
        },
      },
      (response) => {
        res.writeHead(response.statusCode!, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address() as { port: number };
  const options = {
    headless: true,
    baseURL: "http://127.0.0.1:" + address.port,
    viewport: { width: 1440, height: 1000 },
  };
  let context = await engine.launchPersistentContext(directory, options);
  async function disconnect(value: boolean) {
    disconnected = value;
    if (browserName !== "webkit") await context.setOffline(value);
  }
  try {
    let page = await context.newPage();
    await page.goto("/#dashboard");
    await page.getByLabel("用户名", { exact: true }).fill("alice");
    await page
      .getByLabel("密码", { exact: true })
      .fill(process.env.E2E_TEST_PASSWORD!);
    await page.getByRole("button", { name: "登录空间", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "最近", exact: true }),
    ).toBeVisible();
    const stream =
      "BT /F1 20 Tf 60 720 Td (Offline reading verification) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let content = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((object, i) => {
      offsets.push(Buffer.byteLength(content));
      content += `${i + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(content);
    content +=
      `xref\n0 6\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
      `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const pdf = Buffer.from(content);
    await page.getByRole("button", { name: "导入论文", exact: true }).click();
    await page.getByTestId("pdf-file-input").setInputFiles({
      name: "offline.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await expect(page).toHaveURL(/#paper\//);
    const paperId = new URL(page.url()).hash.slice(7).split("?")[0];
    const note = await write(page, "/items", {
      kind: "note",
      paper_id: paperId,
      title: "Offline test note",
      body: "Original note",
    });
    await page.getByLabel("离线阅读选项").click();
    await page
      .getByRole("button", { name: "保存供离线使用", exact: true })
      .click();
    await expect(
      page.getByText("已保存，可离线阅读", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    await disconnect(true);
    await page.goto("/#offline");
    await expect(
      page.getByRole("heading", { name: "本机论文", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("选择离线笔记")
      .selectOption({ label: "Offline test note" });
    await page.getByLabel("离线笔记内容").fill("Written while offline");
    await expect(page.getByRole("status")).toHaveText("已保存到本机 · 待同步");
    await expect
      .poll(() =>
        page
          .getByLabel("论文第 1 页")
          .evaluate((c) => (c as HTMLCanvasElement).width),
      )
      .toBeGreaterThan(500);
    await context.close();
    context = await engine.launchPersistentContext(directory, options);
    await disconnect(true);
    page = await context.newPage();
    await page.goto("/#offline");
    await page
      .getByLabel("选择离线笔记")
      .selectOption({ label: "Offline test note · 待同步" });
    await expect(page.getByLabel("离线笔记内容")).toHaveValue(
      "Written while offline",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "移除本机下载", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("尚未同步");
    const exported = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出本机笔记", exact: true })
      .click();
    expect((await exported).suggestedFilename()).toContain("本机笔记");
    await disconnect(false);
    await page.getByRole("button", { name: "同步笔记", exact: true }).click();
    await expect(
      page.getByText("已与服务器同步", { exact: true }),
    ).toBeVisible();
    const saved = await (
      await page.request.get("/api/v1/items/" + note.id)
    ).json();
    expect(saved.body).toBe("Written while offline");
    await page.getByRole("button", { name: "同步笔记", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "同步笔记", exact: true }),
    ).toBeEnabled();
    expect(
      (await (await page.request.get("/api/v1/items/" + note.id)).json())
        .revision,
    ).toBe(saved.revision);
    await write(
      page,
      "/items/" + note.id,
      {
        kind: "note",
        paper_id: paperId,
        title: note.title,
        body: "Other device note",
      },
      saved.revision,
    );
    await disconnect(true);
    await page.getByLabel("离线笔记内容").fill("Preserve my local changes");
    await expect(page.getByRole("status")).toHaveText("已保存到本机 · 待同步");
    await disconnect(false);
    await page.getByRole("button", { name: "同步笔记", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "另存为新笔记并同步", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "另存为新笔记并同步", exact: true })
      .click();
    await expect(
      page.getByText("已与服务器同步", { exact: true }),
    ).toBeVisible();
    const items = await (
      await page.request.get("/api/v1/items?paper_id=" + paperId)
    ).json();
    expect(items.find((i: any) => i.id === note.id).body).toBe(
      "Other device note",
    );
    expect(
      items.some(
        (i: any) =>
          i.title === note.title + " · 离线副本" &&
          i.body === "Preserve my local changes",
      ),
    ).toBeTruthy();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("离线笔记内容")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.setViewportSize(options.viewport);
    await page.screenshot({
      path: `../test-results/offline-${browserName}.png`,
      fullPage: true,
    });
  } finally {
    await context.close();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
