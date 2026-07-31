import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession, roleHasPermission } from "@/lib/auth/guard";
import { reverseMerge } from "@/lib/services/merge";

// POST /api/v1/transactions/:id/merge/reverse   { mergeId }
//
// Undoes a merge exactly, putting every moved row back on the file it came
// from. Rows created after the merge stay put — they were never part of the
// other file, and moving them would be inventing history.

const bodySchema = z.object({ mergeId: z.string().min(1, "mergeId is required") });

export async function POST(req: Request) {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  if (!roleHasPermission(auth.user.role, "DECIDE_REVIEW_ITEM")) {
    return NextResponse.json({ error: "Your role cannot reverse a merge." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const result = reverseMerge(parsed.data.mergeId, auth.user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
