import { AIProvider } from "./provider";
import { aiProvider as simulatedProvider } from "./engine";
import { createLLMAIProvider } from "./llm-provider";

// -----------------------------------------------------------------------------
// Provider factory. process-email.ts imports getActiveAIProvider() rather
// than the simulated engine directly, so enabling the real LLM provider is
// an env change, not a code change.
//
// Set AI_PROVIDER=llm and ANTHROPIC_API_KEY=sk-ant-... in .env to switch to
// the real Anthropic-backed provider (src/lib/ai/llm-provider.ts). Falls
// back to the deterministic rule-based simulation if the key is missing,
// so the app never crashes on startup because of a config oversight.
// -----------------------------------------------------------------------------
let cachedLLMProvider: AIProvider | null = null;

export function getActiveAIProvider(): AIProvider {
  const configured = process.env.AI_PROVIDER ?? "simulated";

  if (configured === "llm") {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn(
        "[ai-provider] AI_PROVIDER=llm but ANTHROPIC_API_KEY is not set — falling back to the simulated provider."
      );
      return simulatedProvider;
    }
    if (!cachedLLMProvider) cachedLLMProvider = createLLMAIProvider();
    return cachedLLMProvider;
  }

  return simulatedProvider;
}

export { aiProvider } from "./engine";
export type { AIProvider, ExtractedFactCandidate, RequestCandidate } from "./provider";
