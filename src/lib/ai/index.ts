import { AIProvider } from "./provider";
import { aiProvider as simulatedProvider } from "./engine";
import { createLLMAIProvider } from "./llm-provider";
import { withRedaction } from "./sanitize";

// -----------------------------------------------------------------------------
// Provider factory. process-email.ts imports getActiveAIProvider() rather
// than the simulated engine directly, so enabling the real LLM provider is
// an env change, not a code change.
//
// Set AI_PROVIDER=llm and AI_API_KEY=... in .env.local to switch to the real
// hosted-model provider (src/lib/ai/llm-provider.ts). Falls back to the
// deterministic rule-based simulation if the key is missing, so the app never
// crashes on startup because of a config oversight.
//
// The older vendor-specific variable name is still accepted, so an existing
// .env.local keeps working without being edited.
// -----------------------------------------------------------------------------
let cachedLLMProvider: AIProvider | null = null;
let cachedSimulated: AIProvider | null = null;

/**
 * EVERY provider returned from here is wrapped in redaction, including the
 * free rule-based one. Bank details must never reach an evidence summary, a
 * task title or an audit event, and making that depend on which provider
 * happens to be configured would be a rule with a hole in it. See
 * ./sanitize.ts for what is cleaned and, just as importantly, what is not.
 */
export function getActiveAIProvider(): AIProvider {
  const configured = process.env.AI_PROVIDER ?? "simulated";

  if (configured === "llm") {
    if (!process.env.AI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      console.warn(
        "[ai-provider] AI_PROVIDER=llm but AI_API_KEY is not set — falling back to the simulated provider."
      );
      if (!cachedSimulated) cachedSimulated = withRedaction(simulatedProvider);
      return cachedSimulated;
    }
    if (!cachedLLMProvider) cachedLLMProvider = withRedaction(createLLMAIProvider());
    return cachedLLMProvider;
  }

  if (!cachedSimulated) cachedSimulated = withRedaction(simulatedProvider);
  return cachedSimulated;
}

export { aiProvider } from "./engine";
export type { AIProvider, ExtractedFactCandidate, RequestCandidate } from "./provider";
