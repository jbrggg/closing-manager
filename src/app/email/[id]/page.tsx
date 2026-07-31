import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/lib/db";
import { Panel, EmptyState } from "@/components/ui/layout-primitives";
import { ConfidencePill } from "@/components/ui/status-chip";
import { formatDateTime, titleCaseEnum, displayFactValue } from "@/lib/format";
import { requirePageSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function EmailEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageSession();
  const { id } = await params;
  const message = get<any>(`SELECT * FROM EmailMessage WHERE id = ?`, [id]);
  if (!message) notFound();

  const thread = get<any>(`SELECT * FROM EmailThread WHERE id = ?`, [message.threadId]);
  const threadMessages = all<any>(`SELECT * FROM EmailMessage WHERE threadId = ? ORDER BY sentAt ASC`, [message.threadId]);
  const attachments = all<any>(`SELECT * FROM EmailAttachment WHERE messageId = ?`, [id]);
  const extractedFacts = all<any>(`SELECT * FROM ExtractedFact WHERE sourceEmailId = ?`, [id]);
  const proposals = all<any>(`SELECT * FROM AIProposal WHERE sourceEmailIds LIKE ?`, [`%${id}%`]);

  return (
    <div>
      <div className="border-b border-border bg-surface px-6 py-5">
        <div className="text-[11px] font-mono-data text-ink-muted">Mock provider · message {message.id}</div>
        <h1 className="font-serif-head text-[18px] font-semibold text-ink">{thread?.subject ?? message.subject}</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 px-6 py-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Full thread">
            <div className="divide-y divide-line">
              {threadMessages.map((m) => (
                <div key={m.id} className={`px-4 py-3 text-[13px] ${m.id === message.id ? "bg-info-bg" : ""}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">
                      {m.direction === "INCOMING" ? m.fromAddress : `You (${message.direction === "OUTGOING" ? "sent" : "reply"})`}
                    </span>
                    <span className="text-[11px] text-ink-muted">{formatDateTime(m.sentAt)}</span>
                  </div>
                  <div className="text-[11px] text-ink-muted">
                    To: {JSON.parse(m.toAddresses).join(", ")} · {m.direction}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-ink">{m.bodyText}</p>
                  {m.id === message.id && attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {attachments.map((a) => (
                        <div key={a.id} className="inline-flex items-center gap-1 rounded-sm border border-line bg-paper px-2 py-1 text-[11px] text-ink-muted">
                          📎 {a.filename}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Extracted facts from this message">
            {extractedFacts.length === 0 ? (
              <EmptyState message="No facts extracted from this specific message." />
            ) : (
              <div className="divide-y divide-line">
                {extractedFacts.map((f) => (
                  <div key={f.id} className="px-4 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{titleCaseEnum(f.factType)}</span>
                      <ConfidencePill value={f.confidence} />
                    </div>
                    <div className="mt-0.5 text-ink-muted">{displayFactValue(f.factType, JSON.parse(f.structuredValue))}</div>
                    <div className="mt-0.5 text-[11px] text-ink-muted">{f.evidenceSummary}</div>
                    {f.transactionId && (
                      <Link href={`/transactions/${f.transactionId}`} className="mt-1 inline-block text-[11px] text-info underline">
                        View transaction →
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Proposed actions referencing this message">
            {proposals.length === 0 ? (
              <EmptyState message="No proposals reference this message." />
            ) : (
              <div className="divide-y divide-line">
                {proposals.map((p) => (
                  <div key={p.id} className="px-4 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{titleCaseEnum(p.proposalType)}</span>
                      <ConfidencePill value={p.confidence} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-muted">{titleCaseEnum(p.status)}</div>
                    {p.transactionId && (
                      <Link href={`/transactions/${p.transactionId}`} className="mt-1 inline-block text-[11px] text-info underline">
                        View transaction →
                      </Link>
                    )}
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
