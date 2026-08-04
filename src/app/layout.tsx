import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";
import { getSessionUser } from "@/lib/auth/session";

// WCAG 2.4.2 (Page Titled). Every page used to carry the same browser title,
// so someone navigating by screen reader — or just hunting through browser
// tabs — could not tell the review queue from the settings screen. The
// template gives each page its own name while keeping the app's name visible.
export const metadata: Metadata = {
  title: {
    default: "Keystone Closing Operations",
    template: "%s · Keystone Closing Operations",
  },
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
