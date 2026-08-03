"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function ResetSeedButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [justReset, setJustReset] = useState(false);

  return (
    <button
      className="rounded-sm border border-border bg-surface px-3 py-1.5 text-[1rem] font-medium text-ink-muted hover:border-ink hover:text-ink disabled:opacity-50"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await fetch("/api/v1/dev/seed", { method: "POST" });
          setJustReset(true);
          router.refresh();
          setTimeout(() => setJustReset(false), 1500);
        });
      }}
    >
      {pending ? "Resetting…" : justReset ? "Reset ✓" : "Reset demo data"}
    </button>
  );
}
