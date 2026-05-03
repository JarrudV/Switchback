import { GoogleGenAI } from "@google/genai";

let geminiClient: GoogleGenAI | null = null;

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function resolveApiKey(): string {
  const apiKey = firstNonEmpty(
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  );

  if (!apiKey) {
    throw new Error(
      "Gemini API key missing. Set GEMINI_API_KEY (recommended) or AI_INTEGRATIONS_GEMINI_API_KEY.",
    );
  }

  const normalized = apiKey.trim().toUpperCase();
  if (normalized.includes("DUMMY") || normalized.includes("YOUR_") || normalized.includes("REPLACE_ME")) {
    throw new Error(
      "Gemini API key is a placeholder value. Replace it with a real key in GEMINI_API_KEY (or AI_INTEGRATIONS_GEMINI_API_KEY).",
    );
  }

  return apiKey;
}

function resolveBaseUrl(): string | undefined {
  return firstNonEmpty(
    process.env.GEMINI_BASE_URL,
    process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  );
}

export function getGeminiModel(defaultModel = "gemini-2.5-flash"): string {
  return firstNonEmpty(
    process.env.GEMINI_MODEL,
    process.env.AI_INTEGRATIONS_GEMINI_MODEL,
    defaultModel,
  )!;
}

export function getGeminiClient(): GoogleGenAI {
  if (geminiClient) {
    return geminiClient;
  }

  const apiKey = resolveApiKey();
  const baseUrl = resolveBaseUrl();

  geminiClient = new GoogleGenAI({
    apiKey,
    ...(baseUrl
      ? {
          httpOptions: {
            apiVersion: "",
            baseUrl,
          },
        }
      : {}),
  });

  return geminiClient;
}
