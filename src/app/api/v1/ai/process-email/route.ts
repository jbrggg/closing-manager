import { NextResponse } from "next/server";
import { z } from "zod";
import { processEmailMessage } from "@/lib/ai/process-email";
import { requireApiSession } from "@/lib/auth/guard";

const bodySchema = z.object({ emailMessageId: z.string() });

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "emailMessageId is required" }, { status: 400 });
  }
  try {
    const result = await processEmailMessage(parsed.data.emailMessageId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
