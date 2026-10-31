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
    .getByRole("button", { name: "Listen", exact: true })
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
  await expect(page.getByText("Funds held", { exact: true })).toBeVisible({
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
