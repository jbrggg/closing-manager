import { NextResponse } from "next/server";
import { get } from "@/lib/db";
import { requireApiSession } from "@/lib/auth/guard";
import { MicrosoftEmailProvider } from "@/lib/email/microsoft-provider";
import { processEmailMessage } from "@/lib/ai/process-email";
import { recordAudit } from "@/lib/services/audit";

// Pulls new mail from Microsoft Graph and runs each new message through the
// AI pipeline. Call this on a schedule (cron / a scheduled task) once a
// mailbox is connected; a Graph change-notification webhook can replace the
// polling later.
export async function POST() {
  const auth = await requireApiSession("MANAGE_SETTINGS");
  if (auth.failed) return auth.response;

  const account = get<{ id: string; emailAddress: string }>(
    `SELECT id, emailAddress FROM EmailAccount WHERE providerType = 'MICROSOFT_365' LIMIT 1`
  );
  if (!account) {
    return NextResponse.json(
      { error: "No Microsoft mailbox connected. Visit /api/v1/integrations/microsoft/start first." },
      { status: 400 }
    );
  }

  try {
    const provider = new MicrosoftEmailProvider(account.id, account.emailAddress);
    const newMessages = await provider.syncMailbox();

    let processed = 0;
    const failures: string[] = [];
    for (const message of newMessages) {
      try {
        await processEmailMessage(message.id);
        processed++;
      } catch (err) {
        // One bad message must not abort the whole sync.
        failures.push(`${message.id}: ${String(err instanceof Error ? err.message : err)}`);
      }
    }

    recordAudit({
      organizationId: auth.user.organizationId,
      eventType: "email_processed",
      entityType: "EmailAccount",
      entityId: account.id,
      summary: `Outlook sync: ${newMessages.length} new message(s), ${processed} processed, ${failures.length} failed`,
      actorType: "SYSTEM",
    });

    return NextResponse.json({
      ok: true,
      fetched: newMessages.length,
      processed,
      failures,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}
