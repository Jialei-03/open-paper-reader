import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, signIn, who } from "../reader/fixtures";

test.use({ locale: "zh-CN" });

const NO_PDF = "这个页面没有可下载的 PDF，可能需要机构订阅；请下载后拖进来";
const ADDRESS = "https://journal.example.com/article/5?ref=a&b=c";

// Home asks for a model first while there is none: these specs have one.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/translation-settings", (route) =>
    route.fulfill({
      json: {
        active_id: "model-1",
        configured: true,
        models: [{ id: "model-1" }],
      },
    }),
  );
});

/** Answers the general import with an existing paper, and keeps what it was asked. */
async function importsPaper(page: Page, paperId: string) {
  const paper = await (
    await page.request.get(`/api/v1/papers/${paperId}`)
  ).json();
  const asked: { url: string; headers: Record<string, string> }[] = [];
  await page.route("**/api/v1/import/url", (route) => {
    asked.push({
      url: route.request().postDataJSON().url,
      headers: route.request().headers(),
    });
    return route.fulfill({ json: paper });
  });
  return asked;
}

test("#open?url= imports the address and opens the paper", async ({ page }) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  const asked = await importsPaper(page, paperId);
  await page.goto("/#open?url=" + encodeURIComponent(ADDRESS));
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#read/${paperId}$`));
  expect(asked[0].url).toBe(ADDRESS);
  // The service is asked in the usual way: with a progress token and a key.
  expect(asked[0].headers["x-import-id"]).toBeTruthy();
  expect(asked[0].headers["idempotency-key"]).toBeTruthy();
});

test("#open shows the reason an import failed and can be retried", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await page.route("**/api/v1/import/url", (route) =>
    route.fulfill({ status: 422, json: { detail: NO_PDF } }),
  );
  await page.goto("/#open?url=" + encodeURIComponent(ADDRESS));
  await page.reload();
  await expect(page.getByRole("alert")).toHaveText(NO_PDF);
  await expect(page.getByText(ADDRESS)).toBeVisible();
  await page.unroute("**/api/v1/import/url");
  await importsPaper(page, paperId);
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page).toHaveURL(new RegExp(`#read/${paperId}$`));
});

test("an address that is not a web link goes home", async ({ page }) => {
  await signIn(page);
  await page.goto("/#open?url=javascript:alert(1)");
  await expect(page).toHaveURL(/#home$/);
  await expect(page.locator("[data-app-screen=home]")).toBeVisible();
});

test("signed out, #open asks for the sign-in and then goes on", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  await importsPaper(page, paperId);
  await page.context().clearCookies();
  await page.goto("/#open?url=" + encodeURIComponent(ADDRESS));
  await page.reload();
  await page.getByLabel(/^(用户名|Username)$/).fill(who("alice"));
  await page
    .getByLabel(/^(密码|Password)$/)
    .fill(process.env.E2E_TEST_PASSWORD!);
  await page.getByRole("button", { name: /^(登录空间|Sign in)$/ }).click();
  await expect(page).toHaveURL(new RegExp(`#read/${paperId}$`));
});

test("the home box takes any https address, not only arXiv's", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  const asked = await importsPaper(page, paperId);
  let arxivAsked = false;
  await page.route("**/api/v1/import/arxiv", (route) => {
    arxivAsked = true;
    return route.abort();
  });
  await page.goto("/#home");
  const home = page.getByRole("main");
  await home
    .getByRole("textbox", { name: "arXiv 链接或编号" })
    .fill("https://journal.example.com/article/9");
  await home.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#read/${paperId}$`));
  expect(asked.map((a) => a.url)).toEqual([
    "https://journal.example.com/article/9",
  ]);
  expect(arxivAsked).toBe(false);
});

test("the home box says why an address could not be imported", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/v1/import/url", (route) =>
    route.fulfill({ status: 422, json: { detail: NO_PDF } }),
  );
  await page.goto("/#home");
  const home = page.getByRole("main");
  await home
    .getByRole("textbox", { name: "arXiv 链接或编号" })
    .fill("https://paywalled.example.com/a");
  await home.getByRole("button", { name: "导入", exact: true }).click();
  await expect(home.getByRole("alert")).toHaveText(NO_PDF);
});
