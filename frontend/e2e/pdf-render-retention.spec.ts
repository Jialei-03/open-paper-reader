import { test, expect } from "@playwright/test";

test("Offscreen PDF retention evicts oldest pages and never evicts visible pages", async () => {
  const { PdfRenderRetention } = await import(
    "../src/lib/pdf-render-retention"
  );
  const pool = new PdfRenderRetention(2);
  const a = {},
    b = {},
    c = {},
    d = {};
  const evicted: string[] = [];
  pool.retain(a, () => evicted.push("a"));
  pool.retain(b, () => evicted.push("b"));
  pool.visible(a);
  pool.retain(c, () => evicted.push("c"));
  pool.retain(d, () => evicted.push("d"));
  expect(evicted).toEqual(["b"]);
  pool.remove(c);
  pool.retain(a, () => evicted.push("a"));
  expect(evicted).toEqual(["b"]);
});
