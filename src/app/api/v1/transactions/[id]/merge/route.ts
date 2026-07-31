import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/guard";
import { roleHasPermission } from "@/lib/auth/guard";
import { mergeTransactions, previewMerge } from "@/lib/services/merge";

// POST /api/v1/transactions/:id/merge
//   { secondaryTransactionId, explanation?, dryRun? }
//
// `:id` is the transaction that SURVIVES. The secondary is merged into it and
// marked MERGED — never deleted, so existing evidence links stay valid.
//
// Pass `dryRun: true` to get the preview the review queue shows before the
// user commits. Merging the wrong two files is exactly the mistake this
// feature exists to prevent, so it must never be a blind click.

const bodySchema = z.object({
  secondaryTransactionId: z.string().min(1, "secondaryTransactionId is required"),
  explanation: z.string().max(2000).optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  // Merging rewrites which file every fact, task and closing belongs to.
  // Gate it behind the same permission as deciding a review item.
  if (!roleHasPermission(auth.user.role, "DECIDE_REVIEW_ITEM")) {
    return NextResponse.json({ error: "Your role cannot merge transactions." }, { status: 403 });
  }

  const { id: primaryId } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { secondaryTransactionId, explanation, dryRun } = parsed.data;

  try {
    if (dryRun) {
      return NextResponse.json({ ok: true, preview: previewMerge(primaryId, secondaryTransactionId) });
    }
    // Attribution comes from the session, never the request body (invariant 5).
    const result = mergeTransactions(primaryId, secondaryTransactionId, auth.user.id, explanation);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 400 }
    );
  }
}
