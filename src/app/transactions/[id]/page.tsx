import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/lib/db";
import { Panel, EmptyState } from "@/components/ui/layout-primitives";
import { StatusChip, ConfidencePill } from "@/components/ui/status-chip";
import { displayFactValue, formatDateTime, titleCaseEnum } from "@/lib/format";
import { requirePageSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSession();
  const { id } = await params;
  const txn = get<any>(`SELECT * FROM TransactionRecord WHERE id = ?`, [id]);
  if (!txn) notFound();

  const facts = all<any>(`SELECT * FROM ExtractedFact WHERE transactionId = ? ORDER BY extractedAt DESC`, [id]);
  const closings = all<any>(`SELECT * FROM ClosingEvent WHERE transactionId = ? ORDER BY createdAt ASC`, [id]);
  const tasks = all<any>(`SELECT * FROM Task WHERE transactionId = ? ORDER BY createdAt DESC`, [id]);
  const reviewItems = all<any>(
    `SELECT ri.*, p.proposalType, p.confidence FROM ReviewItem ri JOIN AIProposal p ON p.id = ri.proposalId WHERE ri.transactionId = ? ORDER BY ri.createdAt DESC`,
    [id]
  );

  const emailIds = new Set<string>();
  for (const f of facts) emailIds.add(f.sourceEmailId);
  const relatedEmail =
    emailIds.size > 0
      ? all<any>(
          `SELECT * FROM EmailMessage WHERE id IN (${Array.from(emailIds).map(() => "?").join(",")}) ORDER BY sentAt ASC`,
          Array.from(emailIds)
        )
      : [];

  const auditEvents = all<any>(
    `SELECT * FROM AuditEvent WHERE entityId = ? ORDER BY createdAt DESC`,
    [id]
  );

  const currentFacts = facts.filter((f) => f.status === "CURRENT");
  const supersededFacts = facts.filter((f) => f.status === "SUPERSEDED");
  const addressFact = currentFacts.find((f) => f.factType === "PROPERTY_ADDRESS");
  const buyerFact = currentFacts.find((f) => f.factType === "BUYER_NAME");
  const latestClosing = closings[closings.length - 1];

  return (
    <div>
      <div className="border-b border-border bg-surface px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[0.9375rem] font-mono-data text-ink-muted">{txn.id}</div>
            <h1 className="font-serif-head text-[1.625rem] font-semibold text-ink">
              {addressFact ? JSON.parse(addressFact.structuredValue) : "Property pending confirmation"}
            </h1>
            <p className="mt-0.5 text-[1.0625rem] text-ink-muted">
              {buyerFact ? JSON.parse(buyerFact.structuredValue) : "Buyer pending confirmation"}
            </p>
          </div>
          <StatusChip status={txn.status} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 px-6 py-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Closing information">
            {!latestClosing ? (
              <EmptyState message="No closing proposed or confirmed yet." />
            ) : (
              <div className="grid grid-cols-2 gap-4 px-4 py-4 text-[1.0625rem] sm:grid-cols-4">
                <Field label="Status"><StatusChip status={latestClosing.status} /></Field>
                <Field label="Date">{latestClosing.date ? displayFactValue("CLOSING_DATE", JSON.parse(latestClosing.date)) : "TBD"}</Field>
                <Field label="Time">{latestClosing.time ?? "TBD"}</Field>
                <Field label="Location">{latestClosing.locationTBD ? "TBD" : latestClosing.location ?? "TBD"}</Field>
              </div>
            )}
          </Panel>

          <Panel title="Extracted facts (current)">
            {currentFacts.length === 0 ? (
              <EmptyState message="No facts extracted yet." />
            ) : (
              <table className="w-full text-[1.0625rem]">
                <thead>
                  <tr className="border-b border-border bg-paper text-left text-[0.9375rem] uppercase tracking-wide text-ink-muted">
                    <th className="px-4 py-2 font-medium">Fact</th>
                    <th className="px-4 py-2 font-medium">Value</th>
                    <th className="px-4 py-2 font-medium">Confidence</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {currentFacts.map((f) => (
                    <tr key={f.id}>
                      <td className="px-4 py-2 font-medium text-ink">{titleCaseEnum(f.factType)}</td>
                      <td className="px-4 py-2 text-ink-muted">{displayFactValue(f.factType, JSON.parse(f.structuredValue))}</td>
                      <td className="px-4 py-2"><ConfidencePill value={f.confidence} /></td>
                      <td className="px-4 py-2">
                        <Link href={`/email/${f.sourceEmailId}`} className="text-info underline">
                          view email
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {supersededFacts.length > 0 && (
            <Panel title="Superseded facts (history preserved)">
              <table className="w-full text-[1.0625rem]">
                <tbody className="divide-y divide-line">
                  {supersededFacts.map((f) => (
                    <tr key={f.id} className="opacity-70">
                      <td className="px-4 py-2 font-medium text-ink line-through decoration-danger">{titleCaseEnum(f.factType)}</td>
                      <td className="px-4 py-2 text-ink-muted line-through">{displayFactValue(f.factType, JSON.parse(f.structuredValue))}</td>
                      <td className="px-4 py-2 text-[0.9375rem] text-ink-muted">superseded</td>
                      <td className="px-4 py-2">
                        <Link href={`/email/${f.sourceEmailId}`} className="text-info underline">
                          view email
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel title="Tasks">
            {tasks.length === 0 ? (
              <EmptyState message="No tasks for this transaction." />
            ) : (
              <div className="divide-y divide-line">
                {tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-2.5 text-[1.0625rem]">
                    <div>
                      <div className="font-medium text-ink">{t.title}</div>
                      <div className="text-[0.9375rem] text-ink-muted">{t.category} · requested by {t.requester ?? "—"}</div>
                    </div>
                    <StatusChip status={t.status} />
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Related email">
            {relatedEmail.length === 0 ? (
              <EmptyState message="No related email." />
            ) : (
              <div className="divide-y divide-line">
                {relatedEmail.map((m) => (
                  <Link key={m.id} href={`/email/${m.id}`} className="block px-4 py-2.5 text-[1.0625rem] hover:bg-paper">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{m.subject}</span>
                      <span className="text-[0.9375rem] text-ink-muted">{formatDateTime(m.sentAt)}</span>
                    </div>
                    <div className="text-[0.9375rem] text-ink-muted">
                      {m.direction === "INCOMING" ? "From" : "To"}: {m.direction === "INCOMING" ? m.fromAddress : JSON.parse(m.toAddresses).join(", ")}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Review history">
            {reviewItems.length === 0 ? (
              <EmptyState message="No review items." />
            ) : (
              <div className="divide-y divide-line">
                {reviewItems.map((r) => (
                  <div key={r.id} className="px-4 py-2.5 text-[1.0625rem]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{titleCaseEnum(r.proposalType)}</span>
                      <StatusChip status={r.status} />
                    </div>
                    <div className="mt-1 text-[0.9375rem] text-ink-muted">{r.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Audit history">
            {auditEvents.length === 0 ? (
              <EmptyState message="No audit events recorded directly against this transaction." />
            ) : (
              <div className="divide-y divide-line">
                {auditEvents.map((ev) => (
                  <div key={ev.id} className="px-4 py-2.5 text-[1.0625rem]">
                    <div className="text-ink">{ev.summary}</div>
                    <div className="text-[0.9375rem] text-ink-muted">{formatDateTime(ev.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[0.9375rem] uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-0.5 text-ink">{children}</div>
    </div>
  );
}
