import { expect } from 'vitest';

export type OpenAICompatTestConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
};

/**
 * Reads OpenAI-compatible gateway settings from env.
 *
 * Required:
 * - WEB_AGENT_OPENAI_BASE_URL
 * - WEB_AGENT_OPENAI_API_KEY
 *
 * Optional:
 * - WEB_AGENT_OPENAI_MODEL (defaults to gpt-5.2)
 */
export function getOpenAICompatTestConfig(): OpenAICompatTestConfig | null {
  const baseURL = process.env.WEB_AGENT_OPENAI_BASE_URL;
  const apiKey = process.env.WEB_AGENT_OPENAI_API_KEY;
  const model = process.env.WEB_AGENT_OPENAI_MODEL || 'gpt-5.2';

  if (!baseURL || !apiKey) return null;
  return { baseURL, apiKey, model };
}

export function requireOpenAICompat(): OpenAICompatTestConfig {
  const cfg = getOpenAICompatTestConfig();
  expect(cfg, 'Missing OpenAI-compatible test env vars').toBeTruthy();
  return cfg!;
}
