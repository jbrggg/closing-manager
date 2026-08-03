"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Sign-in failed. Please try again.");
        setSubmitting(false);
        return;
      }
      router.replace(nextPath && nextPath.startsWith("/") ? nextPath : "/");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div>
        <label htmlFor="email" className="block text-[1rem] font-medium text-ink">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="mt-1 w-full rounded-sm border border-border bg-paper px-2.5 py-2 text-[1.0625rem] text-ink outline-none focus:border-ink"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-[1rem] font-medium text-ink">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="mt-1 w-full rounded-sm border border-border bg-paper px-2.5 py-2 text-[1.0625rem] text-ink outline-none focus:border-ink"
        />
      </div>

      {error && (
        <div role="alert" className="rounded-sm border border-danger bg-danger-bg px-2.5 py-2 text-[1rem] text-danger">
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting || !email || !password}
        className="w-full rounded-sm bg-ink px-3 py-2 text-[1.0625rem] font-semibold text-paper disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </div>
  );
}
