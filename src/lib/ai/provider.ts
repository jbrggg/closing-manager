import { EmailMessageRow } from "@/types/models";

export interface ExtractedFactCandidate {
  factType:
    | "PROPERTY_ADDRESS"
    | "BUYER_NAME"
    | "SELLER_NAME"
    | "LENDER_NAME"
    | "ATTORNEY_NAME"
    | "REALTOR_NAME"
    | "CLOSING_DATE"
    | "CLOSING_TIME"
    | "CLOSING_LOCATION"
    | "FILE_NUMBER"
    | "LOAN_NUMBER"
    | "DEADLINE"
    | "REQUEST"
    | "MILESTONE"
    | "OTHER";
  value: unknown;
  confidence: number;
  evidenceSummary: string;
}

export interface RequestCandidate {
  isExplicit: boolean;
  taskTitle: string;
  category: string;
  priority: "urgent" | "high" | "normal" | "low";
  evidenceSummary: string;
  confidence: number;
  deadlineHint?: { kind: "explicit" | "inferred" | "office_default"; text: string };
  waitingCondition?: string;
}

// Contract a real AI-model provider (e.g. an LLM extraction service) would
// implement. Async because a real implementation makes a network call —
// see llm-provider.ts for a working hosted-model implementation, and
// engine.ts's SimulatedAIProvider for the deterministic rule-based default
// (its methods are also async, trivially, so both can be used
// interchangeably through this one interface).
export interface AIProvider {
  readonly modelVersion: string;
  extractFacts(message: EmailMessageRow, threadContext: EmailMessageRow[]): Promise<ExtractedFactCandidate[]>;
  detectRequests(message: EmailMessageRow): Promise<RequestCandidate[]>;
  detectCompletionSignal(message: EmailMessageRow): Promise<{ taskHint: string; evidenceSummary: string } | null>;

  /**
   * OPTIONAL, PURELY AN OPTIMISATION — never changes what the pipeline
   * produces, only how many round trips it takes to produce it.
   *
   * The pipeline asks three separate questions about the message it is
   * processing (facts, requests, completion). A network-backed provider can
   * answer all three from a single API call. Calling this first tells such a
   * provider "you are about to be asked all three about this message", so it
   * can start one combined request instead of answering each question with
   * its own round trip.
   *
   * Providers that do no I/O (the rule-based engine) simply don't implement
   * it, and the pipeline behaves exactly as before.
   *
   * It must return immediately without waiting for the answer; any error is
   * surfaced later, by whichever of the three methods is called first.
   */
  prefetchAnalysis?(message: EmailMessageRow, threadContext: EmailMessageRow[]): Promise<void>;
}
