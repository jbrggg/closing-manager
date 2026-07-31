import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Keystone Closing Operations",
  description: "AI-assisted closing and task operations for a title agency",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Null on /login and for signed-out visitors; AppShell then renders the
  // page without navigation chrome.
  const user = await getSessionUser();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <AppShell user={user}>{children}</AppShell>
      </body>
    </html>
  );
}
