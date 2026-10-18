import { expect, test } from "@playwright/test";
import { testPdf } from "../fixtures/pdf";
import { createPaperWithPdf, openReader, signIn } from "./fixtures";

// The interface follows the browser's language; these specs read it in Chinese.
test.use({ locale: "zh-CN" });

test("a page that is rotated and cropped in the file is drawn turned, with its text over the drawing", async ({
  page,
}) => {
  await signIn(page);
  // Turned a quarter, and cut to 572 x 732 points: it is wider than tall when read.
  const { paperId } = await createPaperWithPdf(page, {
    buffer: testPdf({ rotation: 90, cropBox: [20, 30, 592, 762] }),
  });
  await openReader(page, { paperId });
  const first = page.locator('[data-page="1"]');
  await expect(first).toHaveAttribute("data-rendered", "true");
  const canvas = (await first.locator("canvas").boundingBox())!;
  expect(canvas.width).toBeGreaterThan(canvas.height);
  expect(canvas.width / canvas.height).toBeCloseTo(732 / 572, 1);
  const text = first.locator(".textLayer");
  await expect(text).toContainText("Searchable repeated needle");
  const layer = (await text.boundingBox())!;
  for (const side of ["x", "y", "width", "height"] as const)
    expect(Math.abs(layer[side] - canvas[side]), side).toBeLessThanOrEqual(1);
  // The page was turned a quarter clockwise, so its lines run down it.
  const word = (await text
    .locator("span", { hasText: "Searchable" })
    .first()
    .boundingBox())!;
  expect(word.height).toBeGreaterThan(word.width);
});
