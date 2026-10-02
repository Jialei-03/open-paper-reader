import { test, expect } from "@playwright/test";
import { selectionAction } from "./helpers";
import { testPdf } from "./fixtures/pdf";
test("rotation preserves source coordinates, selection, ink and navigation", async ({
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
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const response = await page.request.post("/api/v1/papers", {
    headers,
    data: { title: "PDF rotation fixture", authors: "Test" },
  });
  expect(response.ok()).toBeTruthy();
  const paper = await response.json();
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "navigation.pdf",
        mimeType: "application/pdf",
        buffer: testPdf(),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );

  const first = page.locator('[data-pdf-page="1"] .pdf-page');
  const dimensions = await first.boundingBox();
  const rotate = async (direction: string) => {
    await page.getByRole("button", { name: "旋转 PDF", exact: true }).click();
    await page.getByRole("menuitem", { name: direction }).click();
    await expect(first.locator("canvas")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    // Closing the menu hands focus back to its trigger; a selection made
    // before that moment would have its menu dismissed by the focus change.
    await expect(
      page.getByRole("button", { name: "旋转 PDF", exact: true }),
    ).toBeFocused();
  };
  await rotate("顺时针旋转 90°");
  await expect(first).toHaveAttribute("data-rotation", "90");
  await expect
    .poll(async () => {
      const box = await first.boundingBox();
      return box!.width / box!.height;
    })
    .toBeGreaterThan(1);
  const layer = first.locator(".textLayer");
  await layer.evaluate((el) => {
    const node = el.querySelector("span")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(node);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await selectionAction(page, "高亮");
  await expect(first.getByTestId("pdf-saved-annotation")).toHaveCount(1);
  const geometry = await first.evaluate((el) => {
    const highlight = el
      .querySelector('[data-testid="pdf-saved-annotation"] span')!
      .getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el.querySelector(".textLayer span")!);
    const text = range.getBoundingClientRect();
    return {
      x: Math.abs(highlight.x - text.x),
      y: Math.abs(highlight.y - text.y),
      w: Math.abs(highlight.width - text.width),
    };
  });
  expect(geometry.x).toBeLessThan(3);
  expect(geometry.y).toBeLessThan(3);
  expect(geometry.w).toBeLessThan(3);
  await page.getByRole("radio", { name: "手写笔", exact: true }).click();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(first.locator("[data-stroke]")).toHaveCount(1);
  await page.screenshot({ path: "../test-results/pdf-rotation-90.png" });
  await rotate("逆时针旋转 90°");
  await expect(first).toHaveAttribute("data-rotation", "0");
  await expect
    .poll(
      async () =>
        (await first.boundingBox())!.width /
        (await first.boundingBox())!.height,
    )
    .toBeLessThan(1);
  await expect(first.locator("[data-stroke]")).toHaveCount(1);
  const stroke = await first.locator("[data-stroke]").getAttribute("d");
  expect(stroke).toMatch(/^M400/);
  await page.getByRole("radio", { name: "选择文字", exact: true }).click();
  await page.getByRole("button", { name: "放大 PDF", exact: true }).click();
  await expect(first.locator("canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.getByRole("button", { name: "查找论文", exact: true }).click();
  await page.getByRole("textbox", { name: "查找论文内容" }).fill("needle");
  await expect(
    page.getByTestId("pdf-search-highlight").locator("span").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭论文查找" }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.getByLabel("PDF 页码", { exact: true }).fill("2");
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await rotate("逆时针旋转 90°");
  await expect(first).toHaveAttribute("data-rotation", "270");
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("2");
  await page.screenshot({ path: "../test-results/pdf-rotation.png" });
  await page.reload();
  await expect(page.locator('[data-pdf-page="1"] [data-stroke]')).toHaveCount(
    1,
  );
  expect(dimensions!.height).toBeGreaterThan(dimensions!.width);
});

test("embedded rotation and cropped pages preserve ink, regions, text, export and rapid zoom", async ({
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
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "paper_csrf",
  )!.value;
  const headers = {
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const response = await page.request.post("/api/v1/papers", {
    headers,
    data: { title: "Embedded rotation crop fixture", authors: "Test" },
  });
  expect(response.ok()).toBeTruthy();
  const paper = await response.json();
  const upload = await page.request.post(`/api/v1/papers/${paper.id}/files`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    multipart: {
      version_id: paper.current_version,
      file: {
        name: "navigation.pdf",
        mimeType: "application/pdf",
        buffer: testPdf({ rotation: 90, cropBox: [20, 30, 592, 762] }),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  await page.goto(`/#paper/${paper.id}`);
  await expect(page.getByTestId("pdf-canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );

  const file = await upload.json();
  const first = page.locator('[data-pdf-page="1"] .pdf-page');
  const rotation = async (direction: string, value: string) => {
    await page.getByRole("button", { name: "旋转 PDF", exact: true }).click();
    await page.getByRole("menuitem", { name: direction }).click();
    await expect(first).toHaveAttribute("data-rotation", value);
    await expect(first.locator("canvas")).toHaveAttribute(
      "data-rendered",
      "true",
    );
    await expect(first.locator(".textLayer")).toHaveAttribute(
      "data-main-rotation",
      String((90 + Number(value)) % 360),
    );
  };
  // The overlay re-lays out a frame or two after the text layer, so the
  // highlight must settle on its text rather than match on the first sample.
  // Browsers size glyphs slightly differently at some zoom levels, so "on its
  // text" means within 2% of the page width (at least 3px); a rotation that
  // mapped the mark wrongly would be off by a large part of the page.
  const aligned = () =>
    expect
      .poll(
        () =>
          first.evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el.querySelector(".textLayer span")!);
            const text = range.getBoundingClientRect();
            const mark = el
              .querySelector('[data-testid="pdf-saved-annotation"] span')!
              .getBoundingClientRect();
            const delta = Math.max(
              Math.abs(text.x - mark.x),
              Math.abs(text.y - mark.y),
              Math.abs(text.width - mark.width),
              Math.abs(text.height - mark.height),
            );
            return delta / Math.max(3, 0.02 * el.getBoundingClientRect().width);
          }),
        { message: "highlight stays on its text" },
      )
      .toBeLessThan(1);
  await rotation("顺时针旋转 90°", "90");
  await page
    .getByRole("radio", { name: "框选图表或公式", exact: true })
    .click();
  const regionBox = (await first.boundingBox())!;
  await page.mouse.move(
    regionBox.x + regionBox.width * 0.2,
    regionBox.y + regionBox.height * 0.3,
  );
  await page.mouse.down();
  await page.mouse.move(
    regionBox.x + regionBox.width * 0.4,
    regionBox.y + regionBox.height * 0.5,
    { steps: 5 },
  );
  await page.mouse.up();
  const region = first.getByTestId("pdf-region-highlight");
  await expect(region).toBeVisible();
  const selected = (await region.boundingBox())!;
  expect(
    Math.abs(selected.x - regionBox.x - regionBox.width * 0.2),
  ).toBeLessThan(2);
  expect(Math.abs(selected.width - regionBox.width * 0.2)).toBeLessThan(2);
  await page.getByRole("radio", { name: "选择文字", exact: true }).click();
  await first.locator(".textLayer").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.querySelector("span")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await selectionAction(page, "高亮");
  await expect(first.getByTestId("pdf-saved-annotation")).toHaveCount(1);
  await aligned();
  await page.getByRole("radio", { name: "手写笔", exact: true }).click();
  let box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(first.locator("[data-stroke]")).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/files/${file.id}/ink`)).json())
          .length,
    )
    .toBe(1);
  await rotation("逆时针旋转 90°", "0");
  await aligned();
  const rows = await (
    await page.request.get(`/api/v1/files/${file.id}/ink`)
  ).json();
  expect(rows[0].data.points[0][0]).toBeCloseTo(0.35, 2);
  expect(rows[0].data.points[0][1]).toBeCloseTo(0.5, 2);
  await rotation("逆时针旋转 90°", "270");
  await aligned();
  // Erase the forward-transformed source stroke while total rotation is zero.
  await page.getByRole("radio", { name: "橡皮擦", exact: true }).click();
  box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.up();
  await expect(first.locator("[data-stroke]")).toHaveCount(0);
  await page.getByRole("button", { name: "手写设置", exact: true }).click();
  await page.getByRole("button", { name: "撤销笔迹", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(first.locator("[data-stroke]")).toHaveCount(1);
  await page.getByRole("radio", { name: "选择文字", exact: true }).click();
  // Start a pinch-style wheel gesture, then rotate before its 140ms commit.
  const sheet = page.getByLabel("原文 PDF", { exact: true });
  const sheetbox = (await sheet.boundingBox())!;
  await sheet.dispatchEvent("wheel", {
    ctrlKey: true,
    deltaY: -80,
    clientX: sheetbox.x + 100,
    clientY: sheetbox.y + 150,
    bubbles: true,
    cancelable: true,
  });
  await rotation("顺时针旋转 90°", "0");
  await expect
    .poll(() =>
      page
        .locator(".pdf-pages")
        .evaluate((el) => Number((el as HTMLElement).style.zoom || 1)),
    )
    .toBe(1);
  await expect(first.locator("canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await aligned();
  // Wait beyond both the gesture commit (140ms) and anchor settling (300ms).
  await page.waitForTimeout(500);
  await expect(first).toHaveAttribute("data-rotation", "0");
  await expect(page.getByLabel("PDF 页码", { exact: true })).toHaveValue("1");
  await aligned();
  await page.getByRole("button", { name: "适合宽度", exact: true }).click();
  await expect
    .poll(async () => {
      const box = await first.boundingBox();
      const sheetBox = await sheet.boundingBox();
      return box!.width <= sheetBox!.width;
    })
    .toBe(true);
  await expect(first.locator("canvas")).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await aligned();
  await page.screenshot({
    path: "../test-results/pdf-rotation-crop-embedded.png",
  });
  const exported = await page.request.get(
    `/api/v1/files/${file.id}/annotated-pdf`,
  );
  expect(exported.ok()).toBeTruthy();
  expect((await exported.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const original = await page.request.get(`/api/v1/files/${file.id}/content`);
  expect(await original.body()).toEqual(
    testPdf({ rotation: 90, cropBox: [20, 30, 592, 762] }),
  );
});
