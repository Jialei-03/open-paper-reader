import { test, expect } from "@playwright/test";
import { testPdf } from "./fixtures/pdf";
import { cancelActiveRuns } from "./helpers";

test("Selection actions float without layout shift, share right-click controls and retry the selected text", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.getByRole("heading", { name: "最近" })).toBeVisible();
  await cancelActiveRuns(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const created = await page.request.post("/api/v1/papers", {
    headers,
    data: { title: "Selection menu verification" },
  });
  expect(created.ok()).toBeTruthy();
  const paper = await created.json();
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "selection.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const config = await page.request.post(
    "/api/v1/translation-settings/configs",
    {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        base_url: "https://api.minimax.cn/v1",
        model: "MiniMax-M3",
        name: "Selection fixture",
        protocol: "openai",
        api_key: "synthetic-e2e-key",
      },
    },
  );
  expect(config.ok()).toBeTruthy();
  let attempt = 0;
  const bodies: any[] = [];
  await page.route("**/quick-translation", async (route) => {
    bodies.push(route.request().postDataJSON());
    attempt++;
    await route.fulfill(
      attempt === 1
        ? { status: 502, json: { detail: "暂时不可用" } }
        : { json: { text: "証拠は出典と結びついたままです。" } },
    );
  });
  await page.goto(`/#paper/${paper.id}`);
  await page.evaluate(() =>
    localStorage.setItem("paper-translation-language", JSON.stringify("ja")),
  );
  const line = page
    .getByTestId("pdf-text-layer")
    .first()
    .locator("span")
    .filter({ hasText: "Evidence stays connected" });
  await expect(line).toBeVisible();
  const box = (await line.boundingBox())!;
  const sheet = page.locator(".pdf-sheet").first();
  const before = await sheet.boundingBox();
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  const menu = page.getByRole("dialog", { name: "选中文字操作" });
  await expect(menu).toBeVisible();
  expect(await sheet.boundingBox()).toEqual(before);
  await expect(menu.locator(".pdf-selection-row")).toHaveText([
    "解释E",
    "高亮H",
    "翻译T",
    "评论C",
    "向AI提问Enter",
  ]);
  await menu.getByRole("button", { name: "高亮颜色", exact: true }).click();
  await expect(
    menu.getByRole("button", { name: "绿色", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("t");
  const result = page.getByRole("dialog", { name: "选段快速翻译" });
  await expect(result.getByRole("alert")).toContainText("暂时不可用");
  await result.getByRole("button", { name: "重试", exact: true }).click();
  await expect(result).toContainText("証拠は出典と結びついたままです。");
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({ language: "ja", page: 1 });
  expect(bodies[0].text).toContain("Evidence stays connected");
  expect(await sheet.boundingBox()).toEqual(before);
  await page.keyboard.press("Escape");
  await page.mouse.click(box.x + 10, box.y + box.height / 2, {
    button: "right",
  });
  await expect(menu.getByRole("button", { name: "高亮颜色" })).toBeVisible();
  await menu.getByRole("button", { name: "高亮颜色" }).click();
  await menu.getByRole("button", { name: "绿色", exact: true }).click();
  await expect(menu).not.toBeVisible();
  const file = await upload.json();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/v1/files/${file.id}/annotations`,
      );
      const rows = await response.json();
      return JSON.stringify(rows);
    })
    .toContain("#86EFAC");
  await page.mouse.click(box.x + 10, box.y + box.height / 2, {
    button: "right",
  });
  await menu.getByRole("button", { name: "向AI提问", exact: true }).click();
  await menu
    .getByRole("textbox", { name: "对选中的内容提问" })
    .fill("为什么这些证据必须保留出处？");
  const submission = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/agent\/sessions\/[^/]+\/runs$/.test(r.url()),
  );
  await menu.getByRole("button", { name: "发送问题", exact: true }).click();
  const submitted = await submission;
  expect(submitted.ok()).toBeTruthy();
  const payload = submitted.request().postDataJSON();
  expect(payload.prompt).toBe("为什么这些证据必须保留出处？");
  expect(payload.reader_context).toMatchObject({
    paper_id: paper.id,
    file_id: file.id,
    page: 1,
    source: "selection",
  });
  expect(payload.reader_context.quote).toContain("Evidence stays connected");
  const canonical = await page.request.post(
    `/api/v1/papers/${paper.id}/discussion`,
    {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {},
    },
  );
  expect(submitted.url()).toContain(
    `/sessions/${(await canonical.json()).id}/runs`,
  );
  const run = await submitted.json();
  await page.request.post(`/api/v1/agent/runs/${run.id}/cancel`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {},
  });
});
