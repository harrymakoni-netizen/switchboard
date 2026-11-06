import { NextRequest, NextResponse } from "next/server";
import { APICallError } from "ai";
import {
  AudioInputError,
  readRecording,
  transcribeRecording,
} from "../../../../../packages/agents/src/transcribe";
import { runtime as configuration, session } from "../../../lib/server";
export const runtime = "nodejs";
export const maxDuration = 45;
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(req: NextRequest) {
  try {
    const env = configuration();
    if (req.headers.get("origin") !== new URL(env.APP_URL).origin)
      return reply({ error: "Invalid origin" }, 403);
    if (process.env.HOSTED_UI_ONLY === "1" || env.MOCK_LLM === "1")
      return reply(
        {
          error:
            "Voice transcription is unavailable in this preview. Please type your request.",
        },
        503,
      );
    const { data, mediaType } = await readRecording(req);
    session(true);
    const transcript = await transcribeRecording(data, mediaType, {
      signal: req.signal,
    });
    if (!transcript)
      return reply(
        {
          error:
            "I couldn’t hear any clear speech. Please record again or type your request.",
        },
        422,
      );
    return reply({ transcript });
  } catch (error) {
    if (error instanceof AudioInputError)
      return reply({ error: error.message }, error.status);
    if (APICallError.isInstance(error) && error.statusCode === 429)
      return reply(
        {
          error:
            "Voice transcription is busy. Please try again shortly or type your request.",
        },
        429,
      );
    // Never return provider messages, audio, prompts or credentials.
    return reply(
      {
        error:
          "The recording couldn’t be transcribed. Please try again or type your request.",
      },
      502,
    );
  }
}
