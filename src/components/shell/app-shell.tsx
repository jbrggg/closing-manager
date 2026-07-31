"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useTransition } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/board", label: "Settlement Board" },
  { href: "/transactions", label: "Transactions" },
  { href: "/tasks", label: "Tasks" },
  { href: "/review", label: "Review Queue" },
  { href: "/lab", label: "Email Test Lab" },
  { href: "/activity", label: "AI Activity Log" },
  { href: "/settings", label: "Settings" },
];

interface ShellUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function AppShell({ user, children }: { user: ShellUser | null; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Signed out (or on /login): render the page without navigation chrome.
  if (!user) return <>{children}</>;

  function signOut() {
    startTransition(async () => {
      await fetch("/api/v1/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-screen w-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-ink text-[13px] font-serif-head font-semibold text-paper">
            KT
          </div>
          <div className="leading-tight">
            <div className="font-serif-head text-[14px] font-semibold text-ink">Keystone Title</div>
            <div className="text-[11px] text-ink-muted">Closing Operations</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-sm px-3 py-2 text-[13px] font-medium transition-colors ${
                  active ? "bg-ink text-paper" : "text-ink-muted hover:bg-paper hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-3">
          <div className="text-[13px] font-medium text-ink">{user.name}</div>
          <div className="truncate text-[11px] text-ink-muted">{user.email}</div>
          <div className="mt-1 flex items-center justify-between">
            <span className="rounded-sm bg-neutral-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral">
              {user.role}
            </span>
            <button
              onClick={signOut}
              disabled={pending}
              className="text-[11px] font-medium text-ink-muted underline hover:text-ink disabled:opacity-50"
            >
              {pending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>

        <div className="border-t border-border px-4 py-2.5 text-[11px] text-ink-muted">
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-tentative" />
            Mock mailbox — demo data
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6 md:hidden">
          <div className="font-serif-head text-[15px] font-semibold">Keystone Title</div>
          <button
            onClick={signOut}
            disabled={pending}
            className="text-[12px] font-medium text-ink-muted underline disabled:opacity-50"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 bg-paper">{children}</main>
      </div>
    </div>
  );
}
