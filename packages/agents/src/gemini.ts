import { createGoogle } from "@ai-sdk/google";
import {
  generateText,
  Output,
  NoObjectGeneratedError,
  APICallError,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import { DEFAULT_GEMINI_MODEL } from "@switchboard/shared";
import type { LLM } from "./index";

export class GeminiLLM implements LLM {
  private readonly model: LanguageModel;
  private readonly fallbackModel: LanguageModel;
  readonly fallbackModelId: string;
  readonly modelId: string;

  constructor(
    options: {
      apiKey?: string;
      modelId?: string;
      fallbackModelId?: string;
      fetch?: typeof fetch;
    } = {},
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
    this.fallbackModelId = (
      options.fallbackModelId ??
      process.env.GEMINI_FALLBACK_MODEL ??
      "gemini-3.5-flash-lite"
    ).trim();
    if (!this.fallbackModelId)
      throw new Error("GEMINI_FALLBACK_MODEL must not be empty.");
    this.fallbackModel = google(this.fallbackModelId);
  }

  async json<T>(args: {
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxTokens?: number;
  }): Promise<T> {
    let model = this.model;
    let fallbackUsed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const generate = () =>
          generateText({
            model,
            system: args.system + " Return valid JSON only, without markdown.",
            prompt:
              args.user +
              (attempt
                ? "\nThe prior output failed validation. Return the required schema exactly."
                : ""),
            output: Output.object({ schema: args.schema }),
            reasoning: "low",
            maxOutputTokens: args.maxTokens ?? 2048,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(30000),
          });
        let result;
        try {
          result = await generate();
        } catch (error) {
          if (
            fallbackUsed ||
            this.modelId === this.fallbackModelId ||
            !APICallError.isInstance(error) ||
            ![500, 502, 503, 504].includes(error.statusCode ?? 0)
          )
            throw error;
          fallbackUsed = true;
          model = this.fallbackModel;
          result = await generate();
        }
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
