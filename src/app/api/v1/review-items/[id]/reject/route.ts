import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectReviewItem } from "@/lib/services/approval";
import { requireApiSession } from "@/lib/auth/guard";

const bodySchema = z.object({
  explanation: z.string().optional(),
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
    rejectReviewItem(id, auth.user.id, parsed.data.explanation);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
