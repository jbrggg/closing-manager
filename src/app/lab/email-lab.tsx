"use client";

import { useState } from "react";
import Link from "next/link";
import { ConfidencePill, StatusChip } from "@/components/ui/status-chip";
import { titleCaseEnum, displayFactValue } from "@/lib/format";

interface AnalysisResult {
  engine: { modelVersion: string; isRealAI: boolean };
  messageId: string;
  facts: {
    factType: string;
    value: unknown;
    confidence: number;
    evidenceSummary: string;
  }[];
  proposals: {
    id: string;
    reviewItemId: string | null;
    proposalType: string;
    payload: Record<string, unknown>;
    confidence: number;
    fieldConfidence: Record<string, number>;
    reviewType: string | null;
    reason: string | null;
  }[];
  transaction: {
    id: string;
    status: string | null;
    propertyAddress: string | null;
    linkedToExisting: boolean;
  } | null;
  searchedMailbox: boolean;
}

const FACT_LABELS: Record<string, string> = {
  PROPERTY_ADDRESS: "Property address",
  BUYER_NAME: "Buyer",
  SELLER_NAME: "Seller",
  LENDER_NAME: "Lender",
  ATTORNEY_NAME: "Attorney",
  REALTOR_NAME: "Realtor",
  CLOSING_DATE: "Closing date",
  CLOSING_TIME: "Closing time",
  CLOSING_LOCATION: "Closing location",
  FILE_NUMBER: "File number",
  LOAN_NUMBER: "Loan number",
  MILESTONE: "Transaction milestone",
};

const PROPOSAL_LABELS: Record<string, string> = {
  CLOSING_CREATE: "Schedule a closing",
  CLOSING_RESCHEDULE: "Reschedule a closing",
  CLOSING_CANCEL: "Cancel a closing",
  TASK_CREATE: "Create a task",
  TASK_COMPLETE: "Mark a task complete",
  TRANSACTION_MERGE: "Merge two transactions",
};

export function EmailLab() {
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [direction, setDirection] = useState<"INCOMING" | "OUTGOING">("INCOMING");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function analyze() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/v1/lab/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAddress: fromAddress.trim() || "someone@example.com",
          subject: subject.trim(),
          body,
          direction,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Could not reach the server. Is the app still running?");
    }
    setRunning(false);
  }

  function reset() {
    setFromAddress("");
    setSubject("");
    setBody("");
    setResult(null);
    setError(null);
  }

  return (
    <div className="grid grid-cols-1 gap-4 px-6 py-6 lg:grid-cols-2">
      {/* ---------------- Input ---------------- */}
      <div className="space-y-4">
        <div className="rounded-sm border border-tentative bg-tentative-bg px-4 py-3 text-[1rem]">
          <div className="font-semibold text-tentative">Remove sensitive details first</div>
          <p className="mt-1 text-ink">
            Anything you paste here is stored in this app&apos;s local database. Before pasting, take out
            Social Security numbers, bank account or wire details, and dates of birth. Names and
            addresses are fine and are exactly what the AI needs to be tested on.
          </p>
        </div>

        <div className="rounded-sm border border-border bg-surface p-4">
          <h2 className="text-[1rem] font-semibold uppercase tracking-wide text-ink-muted">
            Paste an email
          </h2>

          <div className="mt-3 space-y-3">
            {/* Each label is tied to its field with htmlFor/id. Sitting next
                to a box is not the same as being attached to it: without the
                pairing a screen reader announces "edit text, blank" and the
                person has no idea what to type. WCAG 1.3.1 and 3.3.2. */}
            <div>
              <label htmlFor="lab-from" className="block text-[1rem] font-medium text-ink">
                Who sent it
              </label>
              <input
                id="lab-from"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder="agent@somerealty.com"
                className="mt-1 w-full rounded-sm border border-border bg-paper px-2.5 py-2 text-[1.0625rem] outline-none focus:border-ink"
              />
            </div>

            <div>
              <label htmlFor="lab-subject" className="block text-[1rem] font-medium text-ink">
                Subject line
              </label>
              <input
                id="lab-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="RE: 123 Main St closing"
                className="mt-1 w-full rounded-sm border border-border bg-paper px-2.5 py-2 text-[1.0625rem] outline-none focus:border-ink"
              />
            </div>

            <div>
              <label htmlFor="lab-body" className="block text-[1rem] font-medium text-ink">
                Email body
              </label>
              <textarea
                id="lab-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder="Paste the text of the email here…"
                className="mt-1 w-full rounded-sm border border-border bg-paper px-2.5 py-2 text-[1.0625rem] outline-none focus:border-ink"
              />
            </div>

            {/* A pair of buttons acting as one either/or choice. Marked up as a
                radiogroup so it is announced as "Direction, 1 of 2 selected"
                rather than as two unrelated buttons. */}
            <div role="radiogroup" aria-labelledby="lab-direction-label">
              <span id="lab-direction-label" className="block text-[1rem] font-medium text-ink">
                Direction
              </span>
              <div className="mt-1 flex gap-2">
                <button
                  role="radio"
                  aria-checked={direction === "INCOMING"}
                  onClick={() => setDirection("INCOMING")}
                  className={`flex-1 rounded-lg border-2 px-4 py-3 text-[1.0625rem] font-semibold ${
                    direction === "INCOMING"
                      ? "border-brand bg-brand text-on-brand"
                      : "border-border bg-surface text-ink"
                  }`}
                >
                  Someone sent it to us
                </button>
                <button
                  role="radio"
                  aria-checked={direction === "OUTGOING"}
                  onClick={() => setDirection("OUTGOING")}
                  className={`flex-1 rounded-lg border-2 px-4 py-3 text-[1.0625rem] font-semibold ${
                    direction === "OUTGOING"
                      ? "border-brand bg-brand text-on-brand"
                      : "border-border bg-surface text-ink"
                  }`}
                >
                  We sent it
                </button>
              </div>
              <p className="mt-1 text-[0.9375rem] text-ink-muted">
                This matters: the AI only looks for task <em>requests</em> in incoming mail, and only
                looks for task <em>completions</em> in mail you sent.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={analyze}
                disabled={running || !subject.trim() || !body.trim()}
                className="flex-1 rounded-sm bg-ink px-3 py-2 text-[1.0625rem] font-semibold text-paper disabled:opacity-50"
              >
                {running ? "Reading the email…" : "Analyze this email"}
              </button>
              <button
                onClick={reset}
                className="rounded-sm border border-border px-3 py-2 text-[1.0625rem] font-medium text-ink-muted hover:text-ink"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------------- Results ---------------- */}
      <div className="space-y-4">
        {error && (
          <div className="rounded-sm border border-danger bg-danger-bg px-4 py-3 text-[1.0625rem] text-danger">
            {error}
          </div>
        )}

        {!result && !error && (
          <div className="rounded-sm border border-border bg-surface px-4 py-10 text-center text-[1.0625rem] text-ink-muted">
            Results will appear here after you analyze an email.
          </div>
        )}

        {result && (
          <>
            <div
              className={`rounded-sm border px-4 py-2.5 text-[1rem] ${
                result.engine.isRealAI
                  ? "border-confirmed bg-confirmed-bg"
                  : "border-tentative bg-tentative-bg"
              }`}
            >
              <span className="font-semibold">
                {result.engine.isRealAI ? "Read by the real AI" : "Read by the basic word-matcher"}
              </span>
              <span className="ml-1 text-ink-muted">({result.engine.modelVersion})</span>
              {!result.engine.isRealAI && (
                <p className="mt-1 text-ink">
                  This is the simple fallback engine, not a real AI. It only spots literal word
                  patterns, so expect it to miss ordinary variation. Set{" "}
                  <code className="font-mono-data">AI_PROVIDER=llm</code> to switch on the real one.
                </p>
              )}
            </div>

            <div className="rounded-sm border border-border bg-surface p-4">
              <h2 className="text-[1rem] font-semibold uppercase tracking-wide text-ink-muted">
                What the AI understood
              </h2>

              {result.facts.length === 0 ? (
                <p className="mt-2 text-[1.0625rem] text-ink-muted">
                  It found no closing-related facts in this email. That&apos;s the right answer for
                  general chatter — but if this email did contain a property, date, or name, that&apos;s
                  a miss worth noting.
                </p>
              ) : (
                <table className="mt-2 w-full text-[1.0625rem]">
                  <tbody className="divide-y divide-line">
                    {result.facts.map((f, i) => (
                      <tr key={i}>
                        <td className="py-1.5 pr-2 text-ink-muted">
                          {FACT_LABELS[f.factType] ?? titleCaseEnum(f.factType)}
                        </td>
                        <td className="py-1.5 pr-2 font-medium text-ink">
                          {displayFactValue(f.factType, f.value)}
                        </td>
                        <td className="py-1.5 text-right">
                          <ConfidencePill value={f.confidence} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <p className="mt-3 text-[0.9375rem] text-ink-muted">
                {result.searchedMailbox
                  ? "This email was missing some closing details, so the AI also searched other messages to fill the gaps."
                  : "The AI read this email and its thread only — it had enough here without searching further."}
              </p>
            </div>

            <div className="rounded-sm border border-border bg-surface p-4">
              <h2 className="text-[1rem] font-semibold uppercase tracking-wide text-ink-muted">
                What it wants to do about it
              </h2>

              {result.proposals.length === 0 ? (
                <p className="mt-2 text-[1.0625rem] text-ink-muted">
                  No actions proposed. Correct if this email was purely informational; a miss if it
                  actually asked you for something.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {result.proposals.map((p) => (
                    <div key={p.id} className="rounded-sm border border-line bg-paper p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[1.0625rem] font-semibold text-ink">
                          {PROPOSAL_LABELS[p.proposalType] ?? titleCaseEnum(p.proposalType)}
                        </span>
                        <ConfidencePill value={p.confidence} />
                      </div>

                      {typeof p.payload.title === "string" && (
                        <div className="mt-1 text-[1.0625rem] text-ink">&ldquo;{p.payload.title}&rdquo;</div>
                      )}

                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.9375rem] text-ink-muted">
                        {typeof p.payload.category === "string" && <span>Type: {p.payload.category}</span>}
                        {typeof p.payload.priority === "string" && (
                          <span>Priority: {p.payload.priority}</span>
                        )}
                        {typeof p.payload.dueAt === "string" && (
                          <span>
                            Due: {new Date(p.payload.dueAt).toLocaleDateString()}
                            {p.payload.dueIsInferred ? " (guessed)" : " (stated in email)"}
                          </span>
                        )}
                        {typeof p.payload.time === "string" && <span>Time: {p.payload.time}</span>}
                        {typeof p.payload.location === "string" && (
                          <span>Location: {p.payload.location}</span>
                        )}
                      </div>

                      {p.reason && <p className="mt-1.5 text-[0.9375rem] text-ink-muted">Why: {p.reason}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {result.transaction && (
              <div className="rounded-sm border border-border bg-surface p-4">
                <h2 className="text-[1rem] font-semibold uppercase tracking-wide text-ink-muted">
                  Which file it filed this under
                </h2>
                <div className="mt-2 flex items-center justify-between text-[1.0625rem]">
                  <div>
                    <div className="font-medium text-ink">
                      {result.transaction.propertyAddress ?? "Property not yet identified"}
                    </div>
                    <div className="text-[0.9375rem] text-ink-muted">
                      {result.transaction.linkedToExisting
                        ? "Attached to an existing transaction it recognized"
                        : "Started a new transaction — it found no confident match"}
                    </div>
                  </div>
                  {result.transaction.status && <StatusChip status={result.transaction.status} />}
                </div>
                <Link
                  href={`/transactions/${result.transaction.id}`}
                  className="mt-2 inline-block text-[1rem] text-info underline"
                >
                  Open the full record →
                </Link>
              </div>
            )}

            <div className="rounded-sm border border-border bg-surface p-4 text-[1.0625rem]">
              <h2 className="text-[1rem] font-semibold uppercase tracking-wide text-ink-muted">
                Score it
              </h2>
              <p className="mt-2 text-ink-muted">
                Ask yourself three things and keep a tally on paper:
              </p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink">
                <li>Did it pull out the right facts, or invent/miss any?</li>
                <li>Did it correctly spot whether someone was asking for something?</li>
                <li>Did it file it under the right property?</li>
              </ol>
              <p className="mt-2 text-[0.9375rem] text-ink-muted">
                Run 20–30 emails and count how many it got fully right. Below roughly 15 out of 20,
                switch to the real AI provider before building anything further.
              </p>
              <Link href="/review" className="mt-2 inline-block text-[1rem] text-info underline">
                These proposals are also waiting in the Review Queue →
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
