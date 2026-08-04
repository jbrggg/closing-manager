import { describe, it, expect } from "vitest";
import { withRedaction } from "@/lib/ai/sanitize";
import { AIProvider } from "@/lib/ai/provider";
import { EmailMessageRow } from "@/types/models";

// Redaction is applied by wrapping the AI provider, so that no future call
// site can forget it. These tests hold that wrapper to two promises: bank
// details never get through, and business identifiers always do.

const msg = () => ({ id: "m1", bodyText: "" }) as unknown as EmailMessageRow;

function providerReturning(overrides: Partial<Record<string, unknown>>): AIProvider {
  return {
    modelVersion: "test",
    async extractFacts() {
      return [
        {
          factType: "LOAN_NUMBER",
          value: "021000021", // checksum-valid, but it IS the loan number
          confidence: 0.9,
          evidenceSummary: "Wire to ABA routing 021000021, loan 021000021.",
          ...(overrides.fact ?? {}),
        },
      ] as never;
    },
    async detectRequests() {
      return [
        {
          taskTitle: "Send payoff to acct 8841200397",
          category: "DOCUMENT_REQUEST",
          priority: "normal",
          evidenceSummary: "Beneficiary account 8841200397 at First Keystone.",
          confidence: 0.8,
          waitingCondition: "once ABA routing 021000021 is confirmed",
          deadlineHint: { kind: "explicit", text: "before wire to routing 021000021" },
          ...(overrides.request ?? {}),
        },
      ] as never;
    },
    async detectCompletionSignal() {
      return {
        taskHint: "sent to acct 8841200397",
        evidenceSummary: "Confirmed against ABA routing 021000021.",
      };
    },
  } as AIProvider;
}

describe("free-form prose is cleaned", () => {
  // The fixture summary is "Wire to ABA routing 021000021, loan 021000021."
  // The SAME nine digits appear twice under two different labels, and the two
  // must be treated differently. This is the whole design in one string.
  it("masks the number labelled as routing, and keeps the one labelled as a loan", async () => {
    const p = withRedaction(providerReturning({}));
    const [fact] = await p.extractFacts(msg(), []);

    expect(fact.evidenceSummary).toContain("[routing ending 0021]");
    expect(fact.evidenceSummary).toContain("loan 021000021");
    // Masked once, kept once — not masked everywhere, not kept everywhere.
    expect(fact.evidenceSummary.match(/021000021/g)).toHaveLength(1);
  });

  it("masks an account number in a task title", async () => {
    const p = withRedaction(providerReturning({}));
    const [req] = await p.detectRequests(msg());
    expect(req.taskTitle).not.toContain("8841200397");
    expect(req.taskTitle).toContain("2856".slice(0, 0) + "[ending 0397]");
  });

  it("masks the waiting condition and the deadline hint", async () => {
    const p = withRedaction(providerReturning({}));
    const [req] = await p.detectRequests(msg());
    expect(req.waitingCondition).not.toContain("021000021");
    expect(req.deadlineHint?.text).not.toContain("021000021");
  });

  it("masks the completion signal", async () => {
    const p = withRedaction(providerReturning({}));
    const signal = await p.detectCompletionSignal(msg());
    expect(signal?.taskHint).not.toContain("8841200397");
    expect(signal?.evidenceSummary).not.toContain("021000021");
  });
});

describe("SAFETY: structured values are never touched", () => {
  it("leaves a loan number intact even when it looks like a routing number", async () => {
    // This is the one that matters. `value` feeds transaction matching, where
    // a loan number is worth 50 points against a 60-point threshold. Masking
    // it would break filing and look like an AI accuracy problem.
    const p = withRedaction(providerReturning({}));
    const [fact] = await p.extractFacts(msg(), []);
    expect(fact.value).toBe("021000021");
  });

  it("leaves fact type, confidence, category and priority alone", async () => {
    const p = withRedaction(providerReturning({}));
    const [fact] = await p.extractFacts(msg(), []);
    const [req] = await p.detectRequests(msg());
    expect(fact.factType).toBe("LOAN_NUMBER");
    expect(fact.confidence).toBe(0.9);
    expect(req.category).toBe("DOCUMENT_REQUEST");
    expect(req.priority).toBe("normal");
    expect(req.deadlineHint?.kind).toBe("explicit");
  });
});

describe("wrapping changes nothing else", () => {
  it("passes the model version through", () => {
    expect(withRedaction(providerReturning({})).modelVersion).toBe("test");
  });

  it("returns null completion signals as null", async () => {
    const inner = providerReturning({});
    const p = withRedaction({ ...inner, async detectCompletionSignal() { return null; } } as AIProvider);
    expect(await p.detectCompletionSignal(msg())).toBeNull();
  });

  it("leaves ordinary text completely unchanged", async () => {
    const clean = providerReturning({
      fact: { evidenceSummary: "Closing confirmed for Thursday, file 25-104427." },
    });
    const [fact] = await withRedaction(clean).extractFacts(msg(), []);
    expect(fact.evidenceSummary).toBe("Closing confirmed for Thursday, file 25-104427.");
  });

  it("does not invent a prefetch method on a provider that has none", () => {
    expect(withRedaction(providerReturning({})).prefetchAnalysis).toBeUndefined();
  });
});
