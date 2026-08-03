"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useTransition } from "react";

/* ---------------------------------------------------------------------------
   APPLICATION SHELL

   Rebuilt 2026-08-03. The old sidebar was 13px grey-on-white links in a 240px
   column. Navigation is the one thing a nervous user reaches for when lost, so
   it is now the most legible thing on screen: dark green panel, white text at
   17px, and a selected item you can identify from across the room.

   Labels are plain English. "Settlement Board" became "Closing Calendar";
   "AI Activity Log" became "What The AI Did". Nobody should need a glossary to
   find the page they want.
--------------------------------------------------------------------------- */

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", hint: "Today at a glance" },
  { href: "/board", label: "Closing Calendar", hint: "Who closes when" },
  { href: "/transactions", label: "Files", hint: "Every property" },
  { href: "/tasks", label: "Tasks", hint: "What has to get done" },
  { href: "/review", label: "Needs Your Review", hint: "The AI is waiting on you" },
  { href: "/lab", label: "Email Test Lab", hint: "Try an email safely" },
  { href: "/activity", label: "What The AI Did", hint: "Full history" },
  { href: "/settings", label: "Settings", hint: "Rules and defaults" },
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
      <aside className="hidden w-72 shrink-0 flex-col bg-brand md:flex">
        <div className="flex items-center gap-3 border-b border-white/20 px-6 py-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-on-brand font-serif-head text-[1.25rem] font-bold text-brand">
            KT
          </div>
          <div className="leading-tight">
            <div className="font-serif-head text-[1.25rem] font-bold text-on-brand">Keystone Title</div>
            <div className="text-[0.9375rem] text-on-brand/80">Closing Operations</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-4 py-5">
          {NAV_ITEMS.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-lg px-4 py-3 transition-colors ${
                  active
                    ? "bg-on-brand text-brand"
                    : "text-on-brand/90 hover:bg-white/15 hover:text-on-brand"
                }`}
              >
                <span className="block text-[1.0625rem] font-bold leading-snug">{item.label}</span>
                <span className={`block text-[0.9375rem] ${active ? "text-brand/75" : "text-on-brand/70"}`}>
                  {item.hint}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/20 px-6 py-4">
          <div className="text-[1.0625rem] font-semibold text-on-brand">{user.name}</div>
          <div className="truncate text-[0.9375rem] text-on-brand/75">{user.email}</div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="rounded-md bg-white/20 px-2.5 py-1 text-[0.875rem] font-bold text-on-brand">
              {user.role}
            </span>
            <button
              onClick={signOut}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-[1rem] font-semibold text-on-brand underline underline-offset-4 hover:bg-white/15 disabled:opacity-50"
            >
              {pending ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>

        <div className="border-t border-white/20 px-6 py-4 text-[0.9375rem] text-on-brand/85">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-tentative-bg" />
            Practice data — no real mailbox
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between bg-brand px-6 py-4 md:hidden">
          <div className="font-serif-head text-[1.25rem] font-bold text-on-brand">Keystone Title</div>
          <button
            onClick={signOut}
            disabled={pending}
            className="text-[1rem] font-semibold text-on-brand underline underline-offset-4 disabled:opacity-50"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 bg-paper">{children}</main>
      </div>
    </div>
  );
}
