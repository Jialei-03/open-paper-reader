import { expect, test, type Page } from "@playwright/test";
import { createPaperWithPdf, signIn, who } from "../reader/fixtures";

// What the service guarantees whatever the screens show: who can see what, what a
// credential may do, what a link gives away, and what is asked before something goes.
test.use({ locale: "zh-CN" });

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "paper_csrf")!
    .value;
}

async function headers(page: Page, extra: Record<string, string> = {}) {
  return {
    "X-CSRF-Token": await csrf(page),
    "Idempotency-Key": crypto.randomUUID(),
    ...extra,
  };
}

async function signInAs(page: Page, name: string, password: string) {
  await page.goto("/#dashboard");
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录空间", exact: true }).click();
  await expect(page.locator("[data-app-screen]")).toBeVisible();
}

/** Makes an account the way the sign-in form does, and leaves `page` signed in as it. */
async function register(page: Page, name: string) {
  await page.goto("/#dashboard");
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page
    .getByLabel("密码", { exact: true })
    .fill(process.env.E2E_TEST_PASSWORD!);
  // No invitation is asked for: the field says it is for sites that need one, and is left empty.
  await page
    .getByRole("button", { name: "注册并进入空间", exact: true })
    .click();
  await expect(page.locator("[data-app-screen]")).toBeVisible();
}

test("the local OpenAPI documentation renders under the restrictive CSP", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/api/v1/docs");
  await expect(page.locator(".swagger-ui")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Authorize", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.opblock-summary-path[data-path="/api/v1/papers"]'),
  ).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("another user can neither open nor read a paper, and a new account starts empty", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);

  const other = await browser.newContext({ locale: "zh-CN" });
  try {
    const bob = await other.newPage();
    await signInAs(bob, who("bob"), process.env.E2E_TEST_PASSWORD!);
    await bob.goto(`/#read/${paperId}`);
    await expect(bob.getByRole("main")).toContainText("找不到这篇论文");
    for (const path of [
      `/api/v1/papers/${paperId}`,
      `/api/v1/papers/${paperId}/files`,
      `/api/v1/papers/${paperId}/shares`,
    ])
      expect((await bob.request.get(path)).status(), path).toBe(404);
    const ids = (await (await bob.request.get("/api/v1/papers")).json()).map(
      (paper: { id: string }) => paper.id,
    );
    expect(ids).not.toContain(paperId);
  } finally {
    await other.close();
  }

  // Registration is open: no invitation is asked for, and the account has nothing in it.
  const fresh = await browser.newContext({ locale: "zh-CN" });
  try {
    const newcomer = await fresh.newPage();
    await register(newcomer, "invited_" + crypto.randomUUID().slice(0, 8));
    expect(await (await newcomer.request.get("/api/v1/papers")).json()).toEqual(
      [],
    );
  } finally {
    await fresh.close();
  }
});

test("an Agent credential only does what its scope says, and none once it is revoked", async ({
  page,
}) => {
  await signIn(page);
  const { paperId } = await createPaperWithPdf(page);
  const name = `Readonly agent ${Date.now().toString(36)}`;
  const created = await page.request.post("/api/v1/tokens", {
    headers: await headers(page),
    data: { name, scopes: ["read"], days: 30 },
  });
  expect(created.ok()).toBeTruthy();
  const { token } = await created.json();
  expect(token).toMatch(/^pp_/);
  const bearer = { Authorization: "Bearer " + token };

  // Reading is allowed, writing is not.
  expect(
    (
      await page.request.get(`/api/v1/papers/${paperId}`, { headers: bearer })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post("/api/v1/papers", {
        data: { title: "denied" },
        headers: { ...bearer, "Idempotency-Key": crypto.randomUUID() },
      })
    ).status(),
  ).toBe(403);
  // A credential cannot make credentials.
  expect(
    (
      await page.request.post("/api/v1/tokens", {
        data: { name: "more", scopes: ["read"], days: 1 },
        headers: { ...bearer, "Idempotency-Key": crypto.randomUUID() },
      })
    ).ok(),
  ).toBeFalsy();

  // Revoking it from the settings ends it.
  await page.goto("/#settings/access");
  const row = page
    .getByRole("region", { name: "分享链接和凭据" })
    .getByRole("list", { name: "Agent 凭据" })
    .getByRole("listitem")
    .filter({ hasText: name });
  await row.getByRole("button", { name: `撤销 ${name}` }).click();
  await page
    .getByRole("dialog", { name: "撤销这个凭据？" })
    .getByRole("button", { name: "撤销" })
    .click();
  await expect(row).toHaveCount(0);
  expect(
    (await page.request.get("/api/v1/papers", { headers: bearer })).status(),
  ).toBe(401);
});

test("a stale revision is refused, and a delete needs its confirmation", async ({
  page,
}) => {
  await signIn(page);
  const create = await page.request.post("/api/v1/papers", {
    headers: await headers(page),
    data: { title: "Revision conflict fixture" },
  });
  expect(create.ok()).toBeTruthy();
  const paper = await create.json();

  const update = async (data: object, revision?: number) =>
    page.request.fetch(`/api/v1/papers/${paper.id}`, {
      method: "PATCH",
      data,
      headers: await headers(
        page,
        revision === undefined ? {} : { "If-Match": String(revision) },
      ),
    });

  // An edit that does not say which revision it read is not taken.
  expect((await update({ abstract: "blind" })).status()).toBe(428);
  const first = await update(
    { abstract: "Changed externally" },
    paper.revision,
  );
  expect(first.ok()).toBeTruthy();
  // The same revision again is stale.
  const stale = await update({ title: "Stale edit" }, paper.revision);
  expect(stale.status()).toBe(409);
  const now = await (
    await page.request.get(`/api/v1/papers/${paper.id}`)
  ).json();
  expect(now.title).toBe("Revision conflict fixture");
  expect(now.abstract).toBe("Changed externally");

  // Deleting names what goes, and the revision it was decided on.
  const remove = async (extra: Record<string, string>) =>
    page.request.delete(`/api/v1/papers/${paper.id}`, {
      headers: await headers(page, extra),
    });
  expect((await remove({ "If-Match": String(now.revision) })).ok()).toBeFalsy();
  expect((await page.request.get(`/api/v1/papers/${paper.id}`)).status()).toBe(
    200,
  );
  expect(
    (
      await remove({
        "If-Match": String(now.revision),
        "X-Confirm-Delete": paper.id,
      })
    ).ok(),
  ).toBeTruthy();
  expect((await page.request.get(`/api/v1/papers/${paper.id}`)).status()).toBe(
    404,
  );
});

test("a shared paper opens without signing in, as a read-only snapshot, until it is revoked", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const paper = await createPaperWithPdf(page, {
    title: "Shared paper fixture",
  });
  const share = await page.request.post(
    `/api/v1/papers/${paper.paperId}/shares`,
    {
      headers: await headers(page),
      data: { file_id: paper.fileId, expires_days: 7 },
    },
  );
  expect(share.ok()).toBeTruthy();
  const { token, url, id } = await share.json();
  expect(url).toMatch(/#shared\/[A-Za-z0-9_-]{43}$/);

  const anon = await browser.newContext({ locale: "zh-CN" });
  try {
    const visitor = await anon.newPage();
    await visitor.goto(`/#shared/${token}`);
    await expect(
      visitor.getByRole("heading", { name: "Shared paper fixture" }),
    ).toBeVisible();
    await expect(visitor.getByText("只读分享", { exact: true })).toBeVisible();
    await expect(visitor.getByLabel("用户名")).toHaveCount(0);
    await expect(visitor.locator("canvas").first()).toHaveAttribute(
      "width",
      /[1-9][0-9]+/,
    );
    await expect(visitor.locator(".textLayer").first()).not.toBeEmpty();
    expect(
      (await visitor.request.get(`/api/v1/shared/${token}/pdf`)).status(),
    ).toBe(200);
    // The link is not the way into the rest of the account.
    expect(
      (await visitor.request.get(`/api/v1/papers/${paper.paperId}`)).status(),
    ).toBeGreaterThanOrEqual(401);

    const revoked = await page.request.delete(
      `/api/v1/papers/${paper.paperId}/shares/${id}`,
      { headers: await headers(page) },
    );
    expect(revoked.ok()).toBeTruthy();
    await visitor.reload();
    await expect(visitor.getByRole("alert")).toContainText(
      "分享不存在或已失效",
    );
    expect(
      (await visitor.request.get(`/api/v1/shared/${token}/pdf`)).status(),
    ).toBeGreaterThanOrEqual(400);
  } finally {
    await anon.close();
  }
});

test("a file nothing refers to can be cleared only when asked to, and a paper's own file cannot", async ({
  page,
}) => {
  // Cleaning up refuses while the owner has running jobs: this scenario has an owner of its own.
  await register(
    page,
    "storage_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12),
  );
  const { paperId, fileId } = await createPaperWithPdf(page);
  const upload = await page.request.post("/api/v1/agent/attachments", {
    headers: { "X-CSRF-Token": await csrf(page) },
    multipart: {
      file: {
        name: "cleanup-draft.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("temporary draft"),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  const file = await upload.json();

  const inventory = async () =>
    (await (await page.request.get("/api/v1/storage-files")).json()).items as {
      id: string;
      kind: string;
      can_delete: boolean;
    }[];
  const listed = (await inventory()).find((row) => row.id === file.id)!;
  expect(listed).toMatchObject({ kind: "chat_attachments", can_delete: true });
  expect((await inventory()).find((row) => row.id === fileId)).toMatchObject({
    kind: "papers",
    can_delete: false,
  });

  const remove = async (kind: string, id: string, confirm = true) =>
    page.request.delete(`/api/v1/storage-files/${kind}/${id}`, {
      headers: await headers(page, confirm ? { "X-Confirm-Delete": id } : {}),
    });
  // Without the confirmation nothing is removed.
  expect((await remove("chat_attachments", file.id, false)).status()).toBe(428);
  expect((await inventory()).some((row) => row.id === file.id)).toBe(true);
  // A paper's own file is not unused.
  expect((await remove("papers", fileId)).status()).toBe(409);
  expect((await remove("chat_attachments", file.id)).ok()).toBeTruthy();
  expect((await inventory()).some((row) => row.id === file.id)).toBe(false);
  expect((await page.request.get(`/api/v1/papers/${paperId}`)).status()).toBe(
    200,
  );
});
