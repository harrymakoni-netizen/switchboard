import { test, expect } from "@playwright/test";
import postgres from "postgres";
test.skip(
  process.env.PARTNER_RESEARCH_MODE !== "mock",
  "Enable offline partner research for these browser checks",
);
test("research persists separately from quotes, respects ownership and limits retries", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .fill("Replace Mum’s geyser element in Avondale tomorrow, under $120");
  await page.getByRole("button", { name: "Find my quotes" }).click();
  await expect(
    page.getByRole("heading", { name: "Research behind your request" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText("$35.00 USD median", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByText("Example Plumbing A", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/These are separate from the demo quote providers/),
  ).toBeVisible();
  const id = page.url().split("/jobs/")[1].split("?")[0];
  const data = await (await page.request.get(`/api/jobs/${id}`)).json();
  expect(
    data.businesses.every(
      (b: { isBot: boolean; name: string }) =>
        b.isBot && !b.name.startsWith("Example"),
    ),
  ).toBe(true);
  expect(data.payments).toEqual([]);
  expect(data.partnerResearch.kernel.data.sessionId).toBe("MOCK-KERNEL");
  expect(data.partnerResearch.channel3.data.medianCents).toBe(3500);
  const retry = await page.request.post(`/api/jobs/${id}/research`, {
    data: {},
  });
  expect(retry.status()).toBe(409);
  const wrongOrigin = await page.request.post(`/api/jobs/${id}/research`, {
    headers: { origin: "https://untrusted.example.org" },
    data: {},
  });
  expect(wrongOrigin.status()).toBe(403);
  const stranger = await browser.newContext();
  expect(
    (
      await stranger.request.get(`http://localhost:3000/api/jobs/${id}`)
    ).status(),
  ).toBe(404);
  expect(
    (
      await stranger.request.post(
        `http://localhost:3000/api/jobs/${id}/research`,
        { data: {} },
      )
    ).status(),
  ).toBe(404);
  await stranger.close();
  // Recreate an existing job that predates partner research, then exercise the manual outbox path.
  const localSql = postgres(process.env.DATABASE_URL!);
  await localSql`delete from events where job_id=${id} and type='partners.updated'`;
  await localSql.end();
  await page.reload();
  await page.getByRole("button", { name: "Research this repair" }).click();
  await expect(
    page.getByText("$35.00 USD median", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.reload();
  await expect(
    page.getByText("$35.00 USD median", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "/workspace/artifacts/switchboard-partners/research-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(
    page.getByRole("heading", { name: "Research behind your request" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: "/workspace/artifacts/switchboard-partners/research-mobile.png",
    fullPage: true,
  });
});
test("a vague repair never acquires a guessed part-price benchmark", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .fill("Fix Mum’s geyser in Avondale tomorrow, under $120");
  await page.getByRole("button", { name: "Find my quotes" }).click();
  await expect(
    page.getByText("No replacement part was identified in this brief."),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "Retry research" }),
  ).toBeVisible();
  await expect(page.getByText("$95.00", { exact: true })).toBeVisible({
    timeout: 20000,
  });
});
