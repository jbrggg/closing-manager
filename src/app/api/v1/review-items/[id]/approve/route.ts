import { NextResponse } from "next/server";
import { z } from "zod";
import { approveReviewItem } from "@/lib/services/approval";
import { requireApiSession } from "@/lib/auth/guard";

const bodySchema = z.object({
  editedPayload: z.record(z.string(), z.any()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession("DECIDE_REVIEW_ITEM");
  if (auth.failed) return auth.response;

  const { id } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // no body sent — fine, defaults apply
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // Attribution comes from the session, never from the request body — the
    // audit trail must record who actually clicked, not who the caller
    // claims to be.
    approveReviewItem(id, auth.user.id, parsed.data.editedPayload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
