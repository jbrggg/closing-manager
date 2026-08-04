import { describe, it, expect } from "vitest";
import {
  parseEnvFile,
  upsertEnvValues,
  quoteIfNeeded,
  maskSecret,
  looksLikeGuid,
  looksLikeEmail,
  looksLikeDomainList,
  normalizeDomainList,
} from "../scripts/env-file.mts";

// `npm run setup` rewrites the one file that holds the API key. If it ever
// drops a line, the app silently falls back to the free word-matcher and looks
// merely worse rather than broken. These tests pin that it never does.

describe("reading .env.local", () => {
  it("reads keys and ignores comments", () => {
    const parsed = parseEnvFile(
      ["# a comment", "AI_PROVIDER=llm", "", "#ANTHROPIC_MODEL=old", "APP_BASE_URL=http://localhost:3000"].join("\n")
    );
    expect(parsed.get("AI_PROVIDER")).toBe("llm");
    expect(parsed.get("APP_BASE_URL")).toBe("http://localhost:3000");
    expect(parsed.has("ANTHROPIC_MODEL")).toBe(false);
  });

  it("strips surrounding quotes", () => {
    expect(parseEnvFile(`MICROSOFT_CLIENT_SECRET="abc~def"`).get("MICROSOFT_CLIENT_SECRET")).toBe("abc~def");
  });

  it("treats an empty assignment as an empty value, not a missing key", () => {
    const parsed = parseEnvFile("ANTHROPIC_API_KEY=");
    expect(parsed.has("ANTHROPIC_API_KEY")).toBe(true);
    expect(parsed.get("ANTHROPIC_API_KEY")).toBe("");
  });
});

describe("rewriting .env.local", () => {
  const original = [
    "# --- AI provider ---",
    "AI_PROVIDER=simulated",
    "ANTHROPIC_API_KEY=sk-ant-existing",
    "",
    "# --- Email ---",
    "EMAIL_PROVIDER=mock",
    "",
  ].join("\n");

  it("edits an existing key in place, keeping its comment", () => {
    const result = upsertEnvValues(original, [{ key: "AI_PROVIDER", value: "llm" }]);

    expect(result).toContain("# --- AI provider ---\nAI_PROVIDER=llm");
    expect(result).toContain("ANTHROPIC_API_KEY=sk-ant-existing");
    expect(result).toContain("EMAIL_PROVIDER=mock");
  });

  it("never drops a value it wasn't asked to change", () => {
    // The expensive failure: setup clobbers the API key it didn't ask about.
    const result = upsertEnvValues(original, [{ key: "MICROSOFT_TENANT_ID", value: "t-1" }]);
    const parsed = parseEnvFile(result);

    expect(parsed.get("ANTHROPIC_API_KEY")).toBe("sk-ant-existing");
    expect(parsed.get("AI_PROVIDER")).toBe("simulated");
    expect(parsed.get("EMAIL_PROVIDER")).toBe("mock");
    expect(parsed.get("MICROSOFT_TENANT_ID")).toBe("t-1");
  });

  it("appends new keys under a labelled section", () => {
    const result = upsertEnvValues(original, [
      { key: "MICROSOFT_CLIENT_ID", value: "c-1" },
      { key: "APP_ENCRYPTION_KEY", value: "key==" },
    ]);

    expect(result).toContain("# --- Added by npm run setup ---");
    expect(result).toContain("MICROSOFT_CLIENT_ID=c-1");
    expect(result).toContain("APP_ENCRYPTION_KEY=key==");
  });

  it("survives being run repeatedly without growing blank lines", () => {
    let text = original;
    for (let i = 0; i < 5; i++) {
      text = upsertEnvValues(text, [{ key: "MICROSOFT_CLIENT_ID", value: `c-${i}` }]);
    }

    expect(parseEnvFile(text).get("MICROSOFT_CLIENT_ID")).toBe("c-4");
    expect(text.match(/MICROSOFT_CLIENT_ID/g)).toHaveLength(1);
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("writes into an empty file", () => {
    const result = upsertEnvValues("", [{ key: "APP_ENCRYPTION_KEY", value: "k" }]);
    expect(parseEnvFile(result).get("APP_ENCRYPTION_KEY")).toBe("k");
  });

  it("keeps CRLF line endings on a file that already has them", () => {
    // The owner runs Windows; a file that flips to LF looks like a whole-file
    // change in every future diff.
    const crlf = "AI_PROVIDER=simulated\r\nEMAIL_PROVIDER=mock\r\n";
    const result = upsertEnvValues(crlf, [{ key: "AI_PROVIDER", value: "llm" }]);

    expect(result).toContain("\r\n");
    expect(result).not.toMatch(/[^\r]\n/);
  });
});

describe("quoting", () => {
  it("quotes values that would otherwise read back wrong", () => {
    expect(quoteIfNeeded("has space")).toBe('"has space"');
    expect(quoteIfNeeded("has#hash")).toBe('"has#hash"');
  });

  it("leaves ordinary values bare", () => {
    expect(quoteIfNeeded("sk-ant-abc123")).toBe("sk-ant-abc123");
    expect(quoteIfNeeded("http://localhost:3000")).toBe("http://localhost:3000");
    expect(quoteIfNeeded("")).toBe("");
  });

  it("round-trips a quoted value back to its original", () => {
    const value = "a secret with spaces";
    expect(parseEnvFile(`K=${quoteIfNeeded(value)}`).get("K")).toBe(value);
  });
});

describe("input checks that save a support call", () => {
  it("recognises a GUID", () => {
    expect(looksLikeGuid("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(looksLikeGuid("common")).toBe(false);
    expect(looksLikeGuid("Xy8Q~abcdefghijklmnop")).toBe(false);
  });

  it("recognises an email address", () => {
    expect(looksLikeEmail("closings@keystonetitle.com")).toBe(true);
    expect(looksLikeEmail("closings")).toBe(false);
  });

  it("recognises a list of our own domains", () => {
    expect(looksLikeDomainList("aglobaltitleagency.com")).toBe(true);
    expect(looksLikeDomainList("aglobaltitleagency.com, psatitle.com")).toBe(true);
    expect(looksLikeDomainList("")).toBe(false);
    // The likely slip: pasting a whole address where a domain was asked for.
    expect(looksLikeDomainList("dana@aglobaltitleagency.com")).toBe(false);
    expect(looksLikeDomainList("aglobaltitleagency")).toBe(false);
  });

  it("tidies up what someone actually types", () => {
    expect(normalizeDomainList("@AGlobalTitleAgency.com")).toBe("aglobaltitleagency.com");
    expect(normalizeDomainList("dana@aglobaltitleagency.com")).toBe("aglobaltitleagency.com");
    expect(normalizeDomainList("a.com, ,A.COM , b.com")).toBe("a.com,b.com");
  });

  it("never shows enough of a secret to use it", () => {
    const masked = maskSecret("Xy8Q~verysecretvalue12345");
    expect(masked).not.toContain("verysecret");
    expect(masked).toContain("Xy8Q");
    expect(maskSecret(undefined)).toBe("(not set)");
    expect(maskSecret("short")).toBe("(set)");
  });
});
