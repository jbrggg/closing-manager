import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { run, get, nowIso } from "@/lib/db";
import { processEmailMessage } from "@/lib/ai/process-email";
import { requireApiSession } from "@/lib/auth/guard";

// Dev-only: simulate a new message arriving in the connected (mock) mailbox
// and immediately run it through the AI pipeline. This is what a real
// provider webhook (Gmail push / Graph change notification) would trigger
// once a live adapter exists.
const bodySchema = z.object({
  subject: z.string(),
  body: z.string(),
  fromAddress: z.string().default("outside.party@example.com"),
  direction: z.enum(["INCOMING", "OUTGOING"]).default("INCOMING"),
  threadId: z.string().optional(),
});

export async function POST(req: Request) {
  const auth = await requireApiSession("MANAGE_DEMO_DATA");
  if (auth.failed) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }
  const { subject, body, fromAddress, direction } = parsed.data;

  const account = get<{ id: string; emailAddress: string }>(`SELECT id, emailAddress FROM EmailAccount LIMIT 1`);
  if (!account) {
    return NextResponse.json({ error: "No email account — seed the database first." }, { status: 400 });
  }

  const threadId = parsed.data.threadId ?? `t-${randomUUID().slice(0, 8)}`;
  const messageId = `m-${randomUUID().slice(0, 8)}`;
  const sentAt = nowIso();
  const participants = [fromAddress, account.emailAddress];

  if (!get(`SELECT id FROM EmailThread WHERE id = ?`, [threadId])) {
    run(`INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`, [
      threadId,
      account.id,
      subject,
      JSON.stringify(participants),
      sentAt,
    ]);
  }

  run(
    `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      messageId,
      threadId,
      `mock-${messageId}`,
      direction === "INCOMING" ? fromAddress : account.emailAddress,
      JSON.stringify(direction === "INCOMING" ? [account.emailAddress] : [fromAddress]),
      subject,
      body,
      direction,
      sentAt,
    ]
  );

  const result = await processEmailMessage(messageId);
  return NextResponse.json({ ok: true, messageId, threadId, ...result });
}
