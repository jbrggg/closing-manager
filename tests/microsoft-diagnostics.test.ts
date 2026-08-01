import { describe, it, expect } from "vitest";
import {
  diagnoseAadResponse,
  diagnoseGraphResponse,
  diagnoseMissingRefreshToken,
  extractAadstsCode,
  formatDiagnosis,
} from "@/lib/email/microsoft-diagnostics";

// The whole point of this module is that the FIRST live connection attempt
// names the wrong thing instead of saying "Graph returned 401". Each test
// below is one wrong thing, using the error text Microsoft actually sends.

/** Real-shaped AAD error body. */
function aadError(code: string, description: string) {
  return JSON.stringify({
    error: "invalid_client",
    error_description: `${code}: ${description}\r\nTrace ID: abc\r\nTimestamp: 2026-07-31 12:00:00Z`,
  });
}

describe("finding the code", () => {
  it("pulls AADSTS out of Microsoft's prose", () => {
    expect(extractAadstsCode("AADSTS7000215: Invalid client secret provided.")).toBe("AADSTS7000215");
  });

  it("returns null when there isn't one", () => {
    expect(extractAadstsCode("something else went wrong")).toBeNull();
  });
});

describe("telling the four failures apart", () => {
  it("a bad client secret is named as a bad client secret", () => {
    const d = diagnoseAadResponse(
      401,
      aadError("AADSTS7000215", "Invalid client secret provided. Ensure the secret being sent in the request is the client secret value")
    );

    expect(d.kind).toBe("client-secret");
    expect(d.problem).toMatch(/client secret is wrong/i);
    // The single most common mix-up must be named explicitly.
    expect(d.fix).toMatch(/Secret ID/);
    expect(d.fix).toMatch(/VALUE/);
  });

  it("a wrong tenant is named as a wrong tenant, not a bad secret", () => {
    const d = diagnoseAadResponse(400, aadError("AADSTS90002", "Tenant 'xyz' not found."));

    expect(d.kind).toBe("tenant");
    expect(d.problem).toMatch(/tenant/i);
    expect(d.fix).toMatch(/Directory \(tenant\) ID/);
    expect(d.fix).not.toMatch(/secret/i);
  });

  it("an app missing from the tenant blames the pairing, not either value alone", () => {
    // The nastiest case: both IDs are individually valid, they just came from
    // different app registrations.
    const d = diagnoseAadResponse(
      400,
      aadError("AADSTS700016", "Application with identifier 'abc' was not found in the directory")
    );

    expect(d.kind).toBe("app-not-in-tenant");
    expect(d.fix).toMatch(/do not belong together|same Overview page/i);
  });

  it("missing admin consent is named as missing admin consent", () => {
    const d = diagnoseAadResponse(
      403,
      aadError("AADSTS65001", "The user or administrator has not consented to use the application")
    );

    expect(d.kind).toBe("consent");
    expect(d.fix).toMatch(/Grant admin consent/i);
  });

  it("an expired secret is distinguished from a wrong one", () => {
    const d = diagnoseAadResponse(401, aadError("AADSTS7000222", "The provided client secret keys are expired."));

    expect(d.kind).toBe("secret-expired");
    expect(d.problem).toMatch(/expired/i);
    expect(d.fix).toMatch(/New client secret/i);
  });

  it("a redirect URI mismatch says it must match exactly", () => {
    const d = diagnoseAadResponse(
      400,
      aadError("AADSTS50011", "The redirect URI specified in the request does not match the redirect URIs configured")
    );

    expect(d.kind).toBe("redirect-uri");
    expect(d.fix).toContain("/api/v1/integrations/microsoft/callback");
    expect(d.fix).toMatch(/trailing slash/i);
  });

  it("says a Conditional Access block is not a settings mistake", () => {
    // Seen for real while testing preflight against a tenant we don't own.
    // If this were reported as a bad secret, someone would spend an hour
    // re-copying a value that was correct all along.
    const d = diagnoseAadResponse(
      400,
      aadError("AADSTS53003", "Access has been blocked by Conditional Access policies.")
    );

    expect(d.kind).toBe("consent");
    expect(d.fix).toMatch(/Nothing in \.env\.local is wrong/);
    expect(d.fix).toMatch(/Conditional Access/);
  });

  it("admits when it doesn't recognise the code rather than guessing", () => {
    const d = diagnoseAadResponse(400, aadError("AADSTS99999", "Something entirely new."));

    expect(d.kind).toBe("unknown");
    expect(d.code).toBe("AADSTS99999");
    expect(d.fix).toMatch(/Guessing here/i);
  });

  it("falls back on the OAuth error name when there is no AADSTS code", () => {
    const d = diagnoseAadResponse(401, JSON.stringify({ error: "invalid_client" }));
    expect(d.kind).toBe("client-secret");
  });
});

describe("missing offline_access", () => {
  it("is caught from the absent refresh token, since Microsoft reports no error", () => {
    const d = diagnoseMissingRefreshToken("openid profile Mail.Read User.Read");

    expect(d.kind).toBe("offline-access");
    expect(d.problem).toMatch(/offline_access/);
    expect(d.fix).toMatch(/about an hour/i);
    expect(d.fix).toContain("openid profile Mail.Read User.Read");
  });
});

describe("errors from Graph itself, once a token exists", () => {
  it("treats a 401 as reconnect, not as a permission problem", () => {
    const d = diagnoseGraphResponse(
      401,
      JSON.stringify({ error: { code: "InvalidAuthenticationToken", message: "Access token has expired." } })
    );

    expect(d.kind).toBe("consent");
    expect(d.fix).toMatch(/reconnect/i);
  });

  it("treats a 403 as a missing Mail.Read, which is a different fix", () => {
    const d = diagnoseGraphResponse(
      403,
      JSON.stringify({ error: { code: "ErrorAccessDenied", message: "Access is denied. Check credentials and try again." } })
    );

    expect(d.kind).toBe("mail-permission");
    expect(d.fix).toMatch(/Mail\.Read/);
  });

  it("names an unlicensed account rather than blaming the app", () => {
    const d = diagnoseGraphResponse(
      404,
      JSON.stringify({ error: { code: "MailboxNotEnabledForRESTAPI", message: "The mailbox is not enabled." } })
    );

    expect(d.kind).toBe("mailbox-missing");
    expect(d.fix).toMatch(/licence|license/i);
  });

  it("says a 429 is not a misconfiguration", () => {
    const d = diagnoseGraphResponse(429, "");
    expect(d.kind).toBe("network");
    expect(d.problem).toMatch(/rate limiting/i);
  });

  it("survives a non-JSON error body", () => {
    const d = diagnoseGraphResponse(502, "<html>Bad Gateway</html>");
    expect(d.kind).toBe("unknown");
  });
});

describe("what the human sees", () => {
  it("always gives one problem line and something to do about it", () => {
    const codes = [
      "AADSTS7000215",
      "AADSTS90002",
      "AADSTS700016",
      "AADSTS65001",
      "AADSTS50011",
      "AADSTS7000222",
    ];

    for (const code of codes) {
      const text = formatDiagnosis(diagnoseAadResponse(400, aadError(code, "x")));
      expect(text, code).toContain(code);
      expect(text.split("\n").filter((l) => l.trim()).length, code).toBeGreaterThan(1);
    }
  });

  it("never tells the user to run curl", () => {
    // Standing rule in CLAUDE.md: never make curl the primary instruction.
    const all = [
      diagnoseAadResponse(401, aadError("AADSTS7000215", "x")),
      diagnoseGraphResponse(403, JSON.stringify({ error: { code: "ErrorAccessDenied" } })),
      diagnoseMissingRefreshToken(),
    ];
    for (const d of all) {
      expect(`${d.problem} ${d.fix}`).not.toMatch(/curl/i);
    }
  });
});
