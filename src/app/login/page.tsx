import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Seed on first visit so the demo accounts below actually exist.
  await ensureSeeded();

  const user = await getSessionUser();
  if (user) redirect("/");

  const { next } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-ink text-[1.1875rem] font-serif-head font-semibold text-paper">
            KT
          </div>
          <div className="leading-tight">
            <div className="font-serif-head text-[1.3125rem] font-semibold text-ink">Keystone Title</div>
            <div className="text-[1rem] text-ink-muted">Closing Operations</div>
          </div>
        </div>

        <div className="rounded-sm border border-border bg-surface p-5">
          <h1 className="font-serif-head text-[1.25rem] font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-[1rem] text-ink-muted">
            Access is restricted to agency staff. All sign-ins are recorded in the audit log.
          </p>
          <LoginForm nextPath={next} />
        </div>

        <div className="mt-4 rounded-sm border border-border bg-surface p-4 text-[1rem]">
          <div className="font-semibold uppercase tracking-wide text-ink-muted">Demo accounts</div>
          <p className="mt-1.5 text-ink-muted">
            Seeded for local evaluation only. Replace these before any real deployment — see the README.
          </p>
          <ul className="mt-2 space-y-1 font-mono-data text-[0.9375rem] text-ink">
            <li>dana@keystonetitle.com · KeystoneDemo2026! · Admin</li>
            <li>marcus@keystonetitle.com · KeystoneDemo2026! · Closer</li>
            <li>priya@keystonetitle.com · KeystoneDemo2026! · Processor</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
