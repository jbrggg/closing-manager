import { NextResponse } from "next/server";
import { all, get } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { requireApiSession } from "@/lib/auth/guard";

const ORG_ID = "org-demo";

export async function GET() {
  const auth = await requireApiSession();
  if (auth.failed) return auth.response;

  await ensureSeeded();

  const closingsToday = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM ClosingEvent WHERE date IS NOT NULL AND status NOT IN ('CANCELLED','COMPLETED')`
  )?.c ?? 0;

  const tentativeClosings = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM ClosingEvent WHERE status = 'TENTATIVE'`
  )?.c ?? 0;

  const confirmedClosings = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM ClosingEvent WHERE status = 'CONFIRMED'`
  )?.c ?? 0;

  const reschedules = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM ClosingEvent WHERE status = 'RESCHEDULED'`
  )?.c ?? 0;

  const newTaskRequests = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM Task WHERE status = 'OPEN'`
  )?.c ?? 0;

  const overdueTasks = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM Task WHERE status NOT IN ('COMPLETED','CANCELLED') AND dueAt IS NOT NULL AND dueAt < datetime('now')`
  )?.c ?? 0;

  const waitingTasks = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM Task WHERE status IN ('WAITING_INTERNALLY','WAITING_EXTERNALLY')`
  )?.c ?? 0;

  const reviewQueueCount = get<{ c: number }>(
    `SELECT COUNT(*) as c FROM ReviewItem WHERE status = 'PENDING'`
  )?.c ?? 0;

  const emailAccounts = all<{ id: string; emailAddress: string; providerType: string; connected: number }>(
    `SELECT id, emailAddress, providerType, connected FROM EmailAccount WHERE organizationId = ?`,
    [ORG_ID]
  );

  const recentActivity = all(
    `SELECT * FROM AuditEvent WHERE organizationId = ? ORDER BY createdAt DESC LIMIT 15`,
    [ORG_ID]
  );

  const recentlyChangedTransactions = all(
    `SELECT * FROM TransactionRecord WHERE organizationId = ? ORDER BY updatedAt DESC LIMIT 8`,
    [ORG_ID]
  );

  return NextResponse.json({
    closingsToday,
    tentativeClosings,
    confirmedClosings,
    reschedules,
    newTaskRequests,
    overdueTasks,
    waitingTasks,
    reviewQueueCount,
    emailAccounts,
    recentActivity,
    recentlyChangedTransactions,
  });
}
