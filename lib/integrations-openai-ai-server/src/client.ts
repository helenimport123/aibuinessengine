import OpenAI from "openai";

function createOpenAIClient(): OpenAI {
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.GROQ_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY must be set. Did you forget to add it to Replit Secrets?",
    );
  }

  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}

let _client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!_client) {
    _client = createOpenAIClient();
  }
  return _client;
}

export const openai: OpenAI = new Proxy({} as OpenAI, {
  get(_target, prop) {
    return (getOpenAIClient() as any)[prop];
  },
});
