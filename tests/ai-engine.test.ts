import "./helpers/test-db";
import { describe, it, expect } from "vitest";
import { aiProvider } from "@/lib/ai/engine";
import { EmailMessageRow } from "@/types/models";

function msg(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return {
    id: "m1",
    threadId: "t1",
    providerMsgId: "p1",
    fromAddress: "agent@example.com",
    toAddresses: JSON.stringify(["closings@keystonetitle.com"]),
    subject: "Test",
    bodyText: "",
    direction: "INCOMING",
    sentAt: "2026-07-20T09:00:00.000Z",
    quotedText: null,
    ...overrides,
  };
}

describe("fact extraction", () => {
  it("extracts a street address", async () => {
    const facts = await aiProvider.extractFacts(
      msg({ bodyText: "Closing for 123 Main Street is set." }),
      []
    );
    const addr = facts.find((f) => f.factType === "PROPERTY_ADDRESS");
    expect(addr?.value).toBe("123 Main Street");
  });

  it("extracts a closing time", async () => {
    const facts = await aiProvider.extractFacts(msg({ bodyText: "The buyer prefers 2:00 PM." }), []);
    expect(facts.find((f) => f.factType === "CLOSING_TIME")?.value).toBe("2:00 PM");
  });

  it("extracts an office location", async () => {
    const facts = await aiProvider.extractFacts(
      msg({ bodyText: "Closing will be at the Cherry Hill office." }),
      []
    );
    expect(facts.find((f) => f.factType === "CLOSING_LOCATION")?.value).toBe("Cherry Hill office");
  });

  it("rates a day reference higher when it carries confirming language", async () => {
    const bare = await aiProvider.extractFacts(msg({ bodyText: "Can we talk Friday?" }), []);
    const confirmed = await aiProvider.extractFacts(msg({ bodyText: "Friday works for the closing." }), []);

    const bareDate = bare.find((f) => f.factType === "CLOSING_DATE");
    const confirmedDate = confirmed.find((f) => f.factType === "CLOSING_DATE");
    expect(confirmedDate!.confidence).toBeGreaterThan(bareDate!.confidence);
  });

  it("REGRESSION: only treats file numbers containing a digit as valid", async () => {
    // A subject ending in 'file' concatenated with a capitalized body word
    // used to be captured as a file number.
    const facts = await aiProvider.extractFacts(
      msg({ subject: "900 Birch Ave — New file", bodyText: "Robert Johnson is the buyer." }),
      []
    );
    const fileNumbers = facts.filter((f) => f.factType === "FILE_NUMBER");
    expect(fileNumbers).toHaveLength(0);
  });

  it("extracts a real file number", async () => {
    const facts = await aiProvider.extractFacts(msg({ bodyText: "File #FN-2201 is open." }), []);
    expect(facts.find((f) => f.factType === "FILE_NUMBER")?.value).toBe("FN-2201");
  });

  it("attaches an evidence summary to every extracted fact", async () => {
    const facts = await aiProvider.extractFacts(
      msg({ bodyText: "123 Main Street closing at 2:00 PM." }),
      []
    );
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.evidenceSummary.length).toBeGreaterThan(0);
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("request detection", () => {
  it("detects an explicit request", async () => {
    const reqs = await aiProvider.detectRequests(msg({ bodyText: "Please send the revised commitment." }));
    expect(reqs).toHaveLength(1);
    expect(reqs[0].isExplicit).toBe(true);
    expect(reqs[0].category).toBe("Commitment revision");
  });

  it("detects an implicit request with lower confidence than an explicit one", async () => {
    const explicit = await aiProvider.detectRequests(msg({ bodyText: "Please send the CPL." }));
    const implicit = await aiProvider.detectRequests(
      msg({ bodyText: "We are still waiting for the CPL." })
    );
    expect(implicit).toHaveLength(1);
    expect(implicit[0].isExplicit).toBe(false);
    expect(implicit[0].confidence).toBeLessThan(explicit[0].confidence);
  });

  it("marks blocking language as urgent", async () => {
    const reqs = await aiProvider.detectRequests(
      msg({ bodyText: "We are still waiting for the CPL and this is holding up underwriting." })
    );
    expect(reqs[0].priority).toBe("urgent");
  });

  it("splits one email into multiple distinct tasks", async () => {
    const reqs = await aiProvider.detectRequests(
      msg({
        bodyText:
          "Can you send the revised commitment? Please confirm whether the payoff has been ordered. Please advise on timing.",
      })
    );
    expect(reqs.length).toBeGreaterThanOrEqual(3);
    const categories = reqs.map((r) => r.category);
    expect(categories).toContain("Commitment revision");
    expect(categories).toContain("Payoff follow-up");
  });

  it("captures an explicit deadline phrase", async () => {
    const reqs = await aiProvider.detectRequests(
      msg({ bodyText: "Please send the revised commitment by Friday." })
    );
    expect(reqs[0].deadlineHint?.kind).toBe("explicit");
    expect(reqs[0].deadlineHint?.text.toLowerCase()).toContain("friday");
  });

  it("ignores plain information that asks for nothing", async () => {
    const reqs = await aiProvider.detectRequests(
      msg({ bodyText: "The property is located in Cherry Hill." })
    );
    expect(reqs).toHaveLength(0);
  });

  it("does not treat a scheduling confirmation as a task", async () => {
    const reqs = await aiProvider.detectRequests(msg({ bodyText: "Friday works for us." }));
    expect(reqs).toHaveLength(0);
  });

  it("never raises tasks from our own outgoing mail", async () => {
    const reqs = await aiProvider.detectRequests(
      msg({ direction: "OUTGOING", bodyText: "Please send the revised commitment." })
    );
    expect(reqs).toHaveLength(0);
  });
});

describe("completion detection", () => {
  it("detects completion language in an outgoing message", async () => {
    const signal = await aiProvider.detectCompletionSignal(
      msg({ direction: "OUTGOING", bodyText: "Please see attached the revised commitment." })
    );
    expect(signal).not.toBeNull();
    expect(signal!.taskHint).toBe("Commitment revision");
  });

  it("ignores incoming mail entirely", async () => {
    const signal = await aiProvider.detectCompletionSignal(
      msg({ direction: "INCOMING", bodyText: "Please see attached the revised commitment." })
    );
    expect(signal).toBeNull();
  });

  it("returns null when an outgoing message signals nothing", async () => {
    const signal = await aiProvider.detectCompletionSignal(
      msg({ direction: "OUTGOING", bodyText: "Thanks, noted." })
    );
    expect(signal).toBeNull();
  });
});
