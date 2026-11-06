import { it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { APICallError } from "ai";
const mocks = vi.hoisted(() => ({
  transcribe: vi.fn(),
  session: vi.fn(),
  mockLLM: "0",
}));
vi.mock("../../../lib/server", () => ({
  runtime: () => ({
    APP_URL: "http://localhost:3000",
    MOCK_LLM: mocks.mockLLM,
  }),
  session: mocks.session,
}));
vi.mock("../../../../../packages/agents/src/transcribe", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../../packages/agents/src/transcribe")
  >()),
  transcribeRecording: mocks.transcribe,
}));
import { POST } from "./route";
function request(origin = "http://localhost:3000") {
  const form = new FormData();
  form.append(
    "audio",
    new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], {
      type: "audio/webm",
    }),
    "recording",
  );
  return new NextRequest("http://localhost:3000/api/transcribe", {
    method: "POST",
    headers: { origin },
    body: form,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockLLM = "0";
  mocks.transcribe.mockResolvedValue("Fix my geyser tomorrow.");
});
it("returns reviewable text and never creates a booking", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    transcript: "Fix my geyser tomorrow.",
  });
  expect(mocks.session).toHaveBeenCalledWith(true);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rejects cross-origin uploads before transcription", async () => {
  expect((await POST(request("https://untrusted.example.org"))).status).toBe(
    403,
  );
  expect(mocks.transcribe).not.toHaveBeenCalled();
});
it("does not invent a transcription in offline mode", async () => {
  mocks.mockLLM = "1";
  expect((await POST(request())).status).toBe(503);
  expect(mocks.transcribe).not.toHaveBeenCalled();
});
it("handles silence, quota errors and private provider failures", async () => {
  mocks.transcribe.mockResolvedValue("");
  expect((await POST(request())).status).toBe(422);
  mocks.transcribe.mockRejectedValue(
    new APICallError({
      message: "secret upstream response",
      url: "https://provider.example.org",
      requestBodyValues: {},
      statusCode: 429,
    }),
  );
  expect((await POST(request())).status).toBe(429);
  mocks.transcribe.mockRejectedValue(
    new Error("private audio and credentials"),
  );
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("credentials");
});
