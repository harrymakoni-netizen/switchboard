import { test, expect, type Page } from "@playwright/test";
async function microphone(
  page: Page,
  mode: "allow" | "denied" | "unsupported" | "mp4" = "allow",
) {
  await page.addInitScript((mode) => {
    const stats = { stopped: 0 };
    Object.defineProperty(window, "voiceTestStats", { value: stats });
    const stream = { getTracks: () => [{ stop: () => stats.stopped++ }] };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        if (mode === "denied")
          throw new DOMException("User denied", "NotAllowedError");
        return stream;
      },
    });
    class Recorder {
      state = "inactive";
      mimeType: string;
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      onerror?: () => void;
      constructor(_stream: unknown, options: { mimeType: string }) {
        this.mimeType = options.mimeType;
      }
      static isTypeSupported(type: string) {
        return mode === "mp4"
          ? type === "audio/mp4"
          : type.startsWith("audio/webm");
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        queueMicrotask(() => {
          const bytes =
            mode === "mp4"
              ? new TextEncoder().encode("0000ftypM4A ")
              : new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
          this.ondataavailable?.({
            data: new Blob([bytes], { type: this.mimeType }),
          });
          this.onstop?.();
        });
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      value: mode === "unsupported" ? undefined : Recorder,
    });
  }, mode);
}
const transcript = "Fix my geyser in Avondale tomorrow, under $120.";
test("records, releases the microphone and appends reviewable text without submitting", async ({
  page,
}) => {
  await microphone(page);
  let jobs = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/jobs") && r.method() === "POST") jobs++;
  });
  await page.route("**/api/transcribe", (route) =>
    route.fulfill({ json: { transcript } }),
  );
  await page.goto("/");
  await page.getByRole("textbox").fill("Please help.");
  await page.getByRole("button", { name: "Record request" }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Find my quotes" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "/workspace/artifacts/switchboard-voice/recording-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.getByRole("textbox")).toHaveValue(
    "Please help. " + transcript,
  );
  await expect(
    page.getByText(
      "Recording added. Review and edit the text before finding quotes.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "voiceTestStats").stopped),
  ).toBeGreaterThan(0);
  expect(jobs).toBe(0);
  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
  await page.screenshot({
    path: "/workspace/artifacts/switchboard-voice/transcript-mobile.png",
    fullPage: true,
  });
});
test("cancel discards audio and preserves typed text", async ({ page }) => {
  await microphone(page);
  let uploads = 0;
  await page.route("**/api/transcribe", (route) => {
    uploads++;
    return route.fulfill({ json: { transcript } });
  });
  await page.goto("/");
  await page.getByRole("textbox").fill("My existing request");
  await page.getByRole("button", { name: "Record request" }).click();
  await page.getByRole("button", { name: "Cancel recording" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("My existing request");
  await expect(page.getByRole("textbox")).toBeEnabled();
  expect(uploads).toBe(0);
});
test("permission denial keeps typing available", async ({ page }) => {
  await microphone(page, "denied");
  await page.goto("/");
  await page.getByRole("textbox").fill("Keep this text");
  await page.getByRole("button", { name: "Record request" }).click();
  await expect(page.locator(".voice-input").getByRole("alert")).toContainText(
    "Microphone access was blocked",
  );
  await expect(page.getByRole("textbox")).toBeEnabled();
  await expect(page.getByRole("textbox")).toHaveValue("Keep this text");
});
test("transcription failure preserves the request and offers retry", async ({
  page,
}) => {
  await microphone(page);
  await page.route("**/api/transcribe", (route) =>
    route.fulfill({
      status: 429,
      json: {
        error:
          "Voice transcription is busy. Please try again shortly or type your request.",
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("textbox").fill("Keep this text");
  await page.getByRole("button", { name: "Record request" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator(".voice-input").getByRole("alert")).toContainText(
    "transcription is busy",
  );
  await expect(page.getByRole("textbox")).toHaveValue("Keep this text");
  await expect(
    page.getByRole("button", { name: "Record request" }),
  ).toBeEnabled();
});
test("unsupported browsers explain the typing fallback", async ({ page }) => {
  await microphone(page, "unsupported");
  await page.goto("/");
  await page.getByRole("button", { name: "Record request" }).click();
  await expect(page.locator(".voice-input").getByRole("alert")).toContainText(
    "isn’t supported in this browser",
  );
  await expect(page.getByRole("textbox")).toBeEnabled();
});
test("auto-stops at 60 seconds and supports the MP4 recording path", async ({
  page,
}) => {
  await microphone(page, "mp4");
  await page.clock.install();
  await page.route("**/api/transcribe", (route) =>
    route.fulfill({ json: { transcript } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Record request" }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording" }),
  ).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(page.getByRole("textbox")).toHaveValue(transcript);
  expect(
    await page.evaluate(() => Reflect.get(window, "voiceTestStats").stopped),
  ).toBeGreaterThan(0);
});

test("cancelling transcription ignores a late response", async ({ page }) => {
  await microphone(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/transcribe", async (route) => {
    await gate;
    await route.fulfill({ json: { transcript } }).catch(() => {});
  });
  await page.goto("/");
  await page.getByRole("textbox").fill("Keep this text");
  await page.getByRole("button", { name: "Record request" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(
    page.getByRole("button", { name: "Transcribing…" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel recording" }).click();
  await page.getByRole("textbox").fill("My revised request");
  release();
  await expect(
    page.getByText("Recording cancelled. Your typed request is unchanged."),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveValue("My revised request");
});
test("a long recording never truncates the existing request", async ({
  page,
}) => {
  await microphone(page);
  await page.route("**/api/transcribe", (route) =>
    route.fulfill({ json: { transcript } }),
  );
  await page.goto("/");
  const original = "x".repeat(1990);
  await page.getByRole("textbox").fill(original);
  await page.getByRole("button", { name: "Record request" }).click();
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator(".voice-input").getByRole("alert")).toContainText(
    "isn’t enough room",
  );
  await expect(page.getByRole("textbox")).toHaveValue(original);
});
