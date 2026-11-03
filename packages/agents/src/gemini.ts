import { createGoogle } from "@ai-sdk/google";
import {
  generateText,
  Output,
  NoObjectGeneratedError,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { DEFAULT_GEMINI_MODEL } from "@switchboard/shared";
import type { LLM } from "./index";

export class GeminiLLM implements LLM {
  private readonly model: LanguageModel;
  readonly modelId: string;

  constructor(
    options: { apiKey?: string; modelId?: string; fetch?: typeof fetch } = {},
  ) {
    const apiKey = (options.apiKey ?? process.env.GEMINI_API_KEY)?.trim();
    if (!apiKey) throw new Error("Set GEMINI_API_KEY when MOCK_LLM=0.");
    this.modelId = (
      options.modelId ??
      process.env.GEMINI_MODEL ??
      DEFAULT_GEMINI_MODEL
    ).trim();
    if (!this.modelId) throw new Error("GEMINI_MODEL must not be empty.");
    const google = createGoogle({ apiKey, fetch: options.fetch });
    this.model = google(this.modelId);
  }

  async json<T>(args: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxTokens?: number;
  }): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await generateText({
          model: this.model,
          system: args.system + " Return valid JSON only, without markdown.",
          prompt:
            args.user +
            (attempt
              ? "\nThe prior output failed validation. Return the required schema exactly."
              : ""),
          output: Output.object({ schema: args.schema }),
          reasoning: "low",
          maxOutputTokens: args.maxTokens ?? 2048,
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(30000),
        });
        return args.schema.parse(result.output);
      } catch (error) {
        if (
          !NoObjectGeneratedError.isInstance(error) &&
          !(error instanceof z.ZodError)
        ) {
          throw new Error(
            "Gemini request failed. Check server configuration or retry.",
            { cause: error },
          );
        }
        if (attempt === 1)
          throw new Error(
            "Gemini returned invalid structured output after two attempts.",
            { cause: error },
          );
      }
    }
    throw new Error("Gemini structured output unavailable.");
  }
}
