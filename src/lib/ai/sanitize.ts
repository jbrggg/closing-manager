import { AIProvider, ExtractedFactCandidate, RequestCandidate } from "./provider";
import { EmailMessageRow } from "@/types/models";
import { redact } from "@/lib/security/redact";

/**
 * REDACTION AT THE PROVIDER BOUNDARY
 *
 * Everything the AI says about an email passes through here on its way into
 * the application, and every piece of free-form prose is stripped of bank
 * details before it can be written anywhere.
 *
 * WHY HERE, RATHER THAN AT EACH DATABASE WRITE
 *
 * Evidence summaries end up in ExtractedFact rows, task titles, proposal
 * payloads, review-item reasons and audit events. Redacting at each of those
 * writes means five places to get right today and an unknown number tomorrow —
 * and the failure mode of forgetting one is silent, permanent, and only
 * discovered by someone reading a database. Wrapping the provider means there
 * is exactly one place to audit, and a new consumer added next year inherits
 * the protection without knowing it exists.
 *
 * WHAT IS DELIBERATELY NOT TOUCHED
 *
 * `value` on a fact candidate is left exactly as the model produced it. That
 * field holds structured data — and specifically it holds LOAN_NUMBER and
 * FILE_NUMBER, which are the strongest signals the matching system has. Those
 * are business identifiers, not bank credentials, and masking them would break
 * transaction matching while looking like an AI accuracy problem. Free-form
 * prose gets cleaned; typed values do not.
 */
export function withRedaction(inner: AIProvider): AIProvider {
  return {
    get modelVersion() {
      return inner.modelVersion;
    },

    async extractFacts(message: EmailMessageRow, threadContext: EmailMessageRow[]) {
      const facts = await inner.extractFacts(message, threadContext);
      return facts.map(
        (f): ExtractedFactCandidate => ({
          ...f,
          // NOTE: f.value is passed through untouched, on purpose. See above.
          evidenceSummary: redact(f.evidenceSummary),
        })
      );
    },

    async detectRequests(message: EmailMessageRow) {
      const requests = await inner.detectRequests(message);
      return requests.map(
        (r): RequestCandidate => ({
          ...r,
          // A task title is read by a person and shown in lists, notifications
          // and the settlement board. It is the single worst place for an
          // account number to come to rest.
          taskTitle: redact(r.taskTitle),
          evidenceSummary: redact(r.evidenceSummary),
          waitingCondition: r.waitingCondition ? redact(r.waitingCondition) : r.waitingCondition,
          deadlineHint: r.deadlineHint
            ? { ...r.deadlineHint, text: redact(r.deadlineHint.text) }
            : r.deadlineHint,
        })
      );
    },

    async detectCompletionSignal(message: EmailMessageRow) {
      const signal = await inner.detectCompletionSignal(message);
      if (!signal) return null;
      return {
        taskHint: redact(signal.taskHint),
        evidenceSummary: redact(signal.evidenceSummary),
      };
    },

    // Purely an optimisation, and it returns nothing — pass it straight
    // through so wrapping never changes the pipeline's behaviour.
    //
    // Forwarded with a rest parameter rather than a named one. The first
    // version of this named only `message` and silently dropped the thread
    // context, which broke prefetching for every message in a thread — a
    // wrapper that quietly loses an argument is the exact failure this
    // comment was claiming not to have. A rest parameter cannot make that
    // mistake, and survives the signature changing later.
    prefetchAnalysis: inner.prefetchAnalysis
      ? (...args: Parameters<NonNullable<AIProvider["prefetchAnalysis"]>>) =>
          inner.prefetchAnalysis!(...args)
      : undefined,
  };
}
