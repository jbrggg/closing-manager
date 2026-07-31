import { NextResponse } from "next/server";
import { all, get } from "@/lib/db";
import { requireApiSession } from "@/lib/auth/guard";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  const { id } = await params;
  const message = get<any>(`SELECT * FROM EmailMessage WHERE id = ?`, [id]);
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thread = get<any>(`SELECT * FROM EmailThread WHERE id = ?`, [message.threadId]);
  const threadMessages = all<any>(`SELECT * FROM EmailMessage WHERE threadId = ? ORDER BY sentAt ASC`, [
    message.threadId,
  ]);
  const attachments = all<any>(`SELECT * FROM EmailAttachment WHERE messageId = ?`, [id]);
  const extractedFacts = all<any>(`SELECT * FROM ExtractedFact WHERE sourceEmailId = ?`, [id]);
  const proposals = all<any>(`SELECT * FROM AIProposal WHERE sourceEmailIds LIKE ?`, [`%${id}%`]);

  return NextResponse.json({
    message,
    thread,
    threadMessages,
    attachments,
    extractedFacts,
    proposals,
  });
}
