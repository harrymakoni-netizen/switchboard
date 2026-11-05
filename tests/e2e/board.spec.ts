import { test, expect } from "@playwright/test";
test("live quotes and mock booking approval", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .fill("Fix Mum’s geyser in Avondale tomorrow, under $120");
  await page.getByRole("button", { name: "Find my quotes" }).click();
  await expect(
    page.getByText("Tendai Plumbing", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("$95.00", { exact: true }).first()).toBeVisible({
    timeout: 20000,
  });
  await expect(
    page.getByText("$110.00", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Transcript", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/Hi, this is an AI assistant/)).toBeVisible();
  await page.getByRole("button", { name: "Close transcript" }).click();
  await page
    .getByRole("button", { name: "Book", exact: true })
    .and(page.locator(":enabled"))
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Fast-forward to completion" }),
  ).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText("$95.00", { exact: true }).first()).toBeVisible();
  await page.screenshot({
    path: "docs/quote-board-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: "docs/quote-board-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("mobile users can compare all quote details and book the earlier provider", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: /Try:/ }).click();
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.getByRole("button", { name: "Find my quotes" }).click();
  await expect(
    page.getByText("2 quotes within your budget.", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  const quick = page
    .getByRole("list", { name: "Provider quotes" })
    .locator("li")
    .filter({
      has: page.getByRole("heading", { name: "QuickFix Geysers", exact: true }),
    });
  await expect(quick.getByText("90 days", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Outside your requested time window", { exact: true }),
  ).toBeVisible();
  await expect(quick.getByText("$110.00", { exact: true })).toBeVisible();
  await quick
    .getByRole("button", { name: "Transcript for QuickFix Geysers" })
    .click();
  await expect(page.getByText(/This conversation is scripted/)).toBeVisible();
  await page.getByRole("button", { name: "Close transcript" }).click();
  await quick
    .getByRole("button", { name: "Book QuickFix Geysers", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Fast-forward to completion" }),
  ).toBeVisible({ timeout: 20000 });
  const id = page.url().split("/jobs/")[1].split("?")[0];
  const data = await (await page.request.get(`/api/jobs/${id}`)).json();
  expect(
    data.payments.find((p: { kind: string }) => p.kind === "authorization")
      .amountCents,
  ).toBe(11000);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/mobile-booking.png", fullPage: true });
});

test("over-budget quotes remain inspectable without offering booking", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page
    .getByRole("textbox")
    .fill("Fix Mum’s geyser in Avondale tomorrow, under $90");
  await page.getByRole("button", { name: "Find my quotes" }).click();
  await expect(
    page.getByText("No bookable quotes within your budget.", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page.getByRole("button", { name: "Book Tendai Plumbing", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Book QuickFix Geysers", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Transcript for Tendai Plumbing" }),
  ).toBeEnabled();
});

test("transcript errors recover and keyboard focus stays in the drawer", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .fill("Fix Mum’s geyser in Avondale tomorrow, under $120");
  await page.getByRole("button", { name: "Find my quotes" }).click();
  await expect(
    page.getByText("2 quotes within your budget.", { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.route("**/transcript", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page
    .getByRole("button", { name: "Transcript", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Retry transcript" }),
  ).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Retry transcript" }),
  ).toBeFocused();
  await page.unroute("**/transcript");
  await page.getByRole("button", { name: "Retry transcript" }).click();
  await expect(page.getByText(/Hi, this is an AI assistant/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Transcript", exact: true }).first(),
  ).toBeFocused();
});

test("the demo guide explains simulated services and the two approvals", async ({
  page,
}) => {
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", {
      name: "A repair request. Two clear approvals.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Simulated transcripts; no phone calls", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Approval two: confirm the work" }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/demo-guide-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/demo-guide-mobile.png", fullPage: true });
  await page.getByRole("link", { name: "Start a demo request" }).click();
  await expect(page.getByRole("textbox")).toBeVisible();
});

test("request page works at desktop and 375px", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /One request/ }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/home-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole("button", { name: "Find my quotes" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "docs/home-mobile.png", fullPage: true });
});
