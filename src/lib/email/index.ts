import { get } from "@/lib/db";
import { EmailProvider } from "./provider";
import { mockEmailProvider } from "./mock-provider";
import { MicrosoftEmailProvider } from "./microsoft-provider";
import { isMicrosoftConfigured } from "./microsoft-oauth";

// -----------------------------------------------------------------------------
// Provider factory. Everything in the app calls getActiveEmailProvider()
// rather than importing a specific provider, so switching mailboxes is a
// configuration change, not a code change.
//
//   EMAIL_PROVIDER=mock       (default) seeded demo mailbox
//   EMAIL_PROVIDER=microsoft  real Outlook / Microsoft 365 via Graph
//   EMAIL_PROVIDER=gmail      not implemented — falls back to mock
//
// Microsoft mode additionally requires a mailbox that has completed the
// OAuth flow at /api/v1/integrations/microsoft/start. Until then we fall
// back to mock with a warning rather than crashing the app, so a
// half-finished setup degrades visibly instead of taking the site down.
// -----------------------------------------------------------------------------
export function getActiveEmailProvider(): EmailProvider {
  const configured = (process.env.EMAIL_PROVIDER ?? "mock").toLowerCase();

  if (configured === "microsoft" || configured === "microsoft_365" || configured === "outlook") {
    if (!isMicrosoftConfigured()) {
      console.warn(
        "[email-provider] EMAIL_PROVIDER=microsoft but MICROSOFT_CLIENT_ID/SECRET are not set — using the mock mailbox. See README → Connecting Outlook."
      );
      return mockEmailProvider;
    }
    const account = get<{ id: string; emailAddress: string; refreshTokenEnc: string | null }>(
      `SELECT id, emailAddress, refreshTokenEnc FROM EmailAccount WHERE providerType = 'MICROSOFT_365' LIMIT 1`
    );
    if (!account?.refreshTokenEnc) {
      console.warn(
        "[email-provider] No Microsoft mailbox has completed OAuth yet — using the mock mailbox. Visit /api/v1/integrations/microsoft/start as an admin to connect one."
      );
      return mockEmailProvider;
    }
    return new MicrosoftEmailProvider(account.id, account.emailAddress);
  }

  if (configured === "gmail") {
    console.warn(
      "[email-provider] The Gmail adapter is a scaffold and is not implemented — using the mock mailbox. See src/lib/email/gmail-provider.ts."
    );
    return mockEmailProvider;
  }

  return mockEmailProvider;
}

/** True when real Outlook mail is actually flowing (used by the Settings UI). */
export function activeProviderLabel(): { label: string; isLive: boolean } {
  const provider = getActiveEmailProvider();
  return provider.type === "MICROSOFT_365"
    ? { label: "Microsoft 365 (live)", isLive: true }
    : { label: "Mock mailbox (demo data)", isLive: false };
}

export { mockEmailProvider } from "./mock-provider";
export type { EmailProvider, MailboxSearchQuery } from "./provider";
