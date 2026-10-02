import { test, expect } from "@playwright/test";

test("Math renders in Markdown and editable notes without losing LaTeX on save", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill("alice");
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: "登录空间" }).click();
  await expect(
    page.getByRole("button", { name: "打开研究助手" }),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const body = String.raw`行内公式 $E=mc^2$。

$$
\frac{a+b}{c}=\sum_{i=1}^{n} x_i
$$

代码保持原样：

\`\`\`text
$$not math$$
\`\`\`
`.replaceAll("\\`", "`");
  const response = await page.request.post("/api/v1/papers", {
    headers: { "X-CSRF-Token": csrf, "Idempotency-Key": crypto.randomUUID() },
    data: { title: "公式渲染验收", abstract: body },
  });
  expect(response.ok()).toBeTruthy();
  const paper = await response.json();
  const note = (
    await (await page.request.get(`/api/v1/items?paper_id=${paper.id}`)).json()
  )[0];
  const saved = await page.request.put(`/api/v1/items/${note.id}`, {
    headers: {
      "X-CSRF-Token": csrf,
      "Idempotency-Key": crypto.randomUUID(),
      "If-Match": String(note.revision),
    },
    data: {
      kind: "note",
      paper_id: paper.id,
      title: note.title,
      body,
      status: "open",
      tags: [],
      paper_ids: [],
      evidence_ids: [],
      locator: null,
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto(`/#paper/${paper.id}`);
  const editor = page.getByRole("textbox", { name: "笔记正文" });
  await expect(editor.locator(".katex")).toHaveCount(2);
  await expect(editor.locator("pre")).toContainText("$$not math$$");
  await editor.locator('[data-type="block-math"]').click();
  await page
    .getByLabel("LaTeX 公式", { exact: true })
    .fill(String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`);
  await page.getByRole("button", { name: "保存公式", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/items/${note.id}`)).json())
          .body,
    )
    .toContain(String.raw`\int_0^1`);
  await page.reload();
  await expect(editor.locator(".katex")).toHaveCount(2);
  await expect(editor.locator('[data-type="block-math"]')).toHaveAttribute(
    "data-latex",
    String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`,
  );
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await editor.pressSequentially("$$a^2+b^2=c^2$$");
  await expect(editor.locator('[data-type="block-math"]')).toHaveCount(2);
  await page.getByRole("button", { name: "论文信息", exact: true }).click();
  await page.getByText("原文摘要", { exact: true }).click();
  await expect(page.locator(".abstract .markdown .katex")).toHaveCount(2);
  await expect(page.locator(".abstract .markdown pre")).toContainText(
    "$$not math$$",
  );
  await page.screenshot({ path: "../test-results/markdown-math.png" });
});
