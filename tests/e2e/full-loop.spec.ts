import { test, expect, type Page } from "@playwright/test";
async function book(page: Page) {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .fill("Fix Mum’s geyser in Avondale tomorrow, under $120");
  await page.getByRole("button", { name: "Find my quotes" }).click();
  await expect(page.getByText("$95.00", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page
    .getByRole("button", { name: "Book", exact: true })
    .and(page.locator(":enabled"))
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Fast-forward to completion" }),
  ).toBeVisible({ timeout: 20000 });
  return page.url().split("/jobs/")[1].split("?")[0];
}
async function snapshot(page: Page, id: string) {
  return (await page.request.get("/api/jobs/" + id)).json();
}
test("full loop closes in under 60 seconds with one capture, payout and receipt", async ({
  page,
}) => {
  const start = Date.now();
  const id = await book(page);
  await page.getByRole("button", { name: "Show payout recipient" }).click();
  await expect(page.getByText(/Payout will go to/)).toBeVisible();
  await page
    .getByRole("button", { name: "Fast-forward to completion" })
    .click();
  await expect(
    page.getByRole("button", { name: "Mark done · release payment" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Mark done · release payment" })
    .click();
  await expect(
    page.getByText("All taken care of.", { exact: false }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("link", { name: "View receipt" })).toBeVisible({
    timeout: 10000,
  });
  const data = await snapshot(page, id);
  expect(data.job.state).toBe("CLOSED");
  expect(
    data.payments.filter((p: { kind: string }) => p.kind === "capture"),
  ).toHaveLength(1);
  expect(
    data.payments.filter((p: { kind: string }) => p.kind === "payout"),
  ).toHaveLength(1);
  const capture = data.payments.find(
    (p: { kind: string }) => p.kind === "capture",
  );
  const payout = data.payments.find(
    (p: { kind: string }) => p.kind === "payout",
  );
  expect(payout.amountCents).toBe(capture.amountCents);
  expect(Date.now() - start).toBeLessThan(60000);
  const again = await page.request.post(`/api/jobs/${id}/done`, {
    data: { done: true },
  });
  expect(again.status()).toBe(400);
  const receipt = await page.request.get(`/api/jobs/${id}/receipt`);
  expect(receipt.status()).toBe(200);
  expect(await receipt.text()).toContain("No real money moved");
  await page.screenshot({ path: "docs/completed-job.png", fullPage: true });
});
test("cancel after booking voids hold without capture", async ({ page }) => {
  const id = await book(page);
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect
    .poll(
      async () => {
        const d = await snapshot(page, id);
        return d.payments.some((p: { kind: string }) => p.kind === "void");
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const d = await snapshot(page, id);
  expect(d.job.state).toBe("CANCELLED");
  expect(d.payments.some((p: { kind: string }) => p.kind === "capture")).toBe(
    false,
  );
});
test("not done enters ISSUE and keeps hold", async ({ page }) => {
  const id = await book(page);
  await page
    .getByRole("button", { name: "Fast-forward to completion" })
    .click();
  await page
    .getByRole("button", { name: "Not done · keep funds held" })
    .click();
  await expect
    .poll(async () => (await snapshot(page, id)).job.state)
    .toBe("ISSUE");
  const d = await snapshot(page, id);
  expect(
    d.payments.some((p: { kind: string }) => p.kind === "authorization"),
  ).toBe(true);
  expect(
    d.payments.some((p: { kind: string }) =>
      ["capture", "void"].includes(p.kind),
    ),
  ).toBe(false);
});
test("anonymous sessions isolate jobs", async ({ page, browser }) => {
  const id = await book(page);
  const other = await browser.newContext();
  const response = await other.request.get(
    "http://localhost:3000/api/jobs/" + id,
  );
  expect(response.status()).toBe(404);
  await other.close();
});
