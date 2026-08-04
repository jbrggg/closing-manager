import { requirePageSession } from "@/lib/auth/guard";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { PageHeader } from "@/components/ui/layout-primitives";
import { EmailLab } from "./email-lab";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Email Test Lab",
};

export const dynamic = "force-dynamic";

export default async function LabPage() {
  await requirePageSession();
  await ensureSeeded();

  return (
    <div>
      <PageHeader
        title="Email Test Lab"
        subtitle="Paste a real email and see exactly what the AI understands — before connecting a live mailbox"
      />
      <EmailLab />
    </div>
  );
}
