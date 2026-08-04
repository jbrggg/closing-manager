import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { PageHeader } from "@/components/ui/layout-primitives";
import { TaskTable } from "./task-table";
import { requirePageSession } from "@/lib/auth/guard";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tasks",
};

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  await requirePageSession();
  await ensureSeeded();
  const tasks = all<any>(`SELECT * FROM Task ORDER BY createdAt DESC`);
  const enriched = tasks.map((t) => {
    const address = t.transactionId
      ? all<any>(
          `SELECT structuredValue FROM ExtractedFact WHERE transactionId = ? AND factType = 'PROPERTY_ADDRESS' AND status = 'CURRENT' LIMIT 1`,
          [t.transactionId]
        )[0]
      : null;
    return { ...t, propertyAddress: address ? JSON.parse(address.structuredValue) : null };
  });

  return (
    <div>
      <PageHeader title="Tasks" subtitle={`${enriched.length} task(s) across all transactions`} />
      <div className="px-6 py-6">
        <TaskTable tasks={JSON.parse(JSON.stringify(enriched))} />
      </div>
    </div>
  );
}
