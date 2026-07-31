import "./helpers/test-db";
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/lib/auth/password";
import { roleHasPermission } from "@/lib/auth/guard";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password entirely", hash)).toBe(false);
  });

  it("never stores the plaintext password", async () => {
    const hash = await hashPassword("SuperSecret12345");
    expect(hash).not.toContain("SuperSecret12345");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password 123");
    const b = await hashPassword("same password 123");
    expect(a).not.toBe(b);
    // ...but both still verify
    expect(await verifyPassword("same password 123", a)).toBe(true);
    expect(await verifyPassword("same password 123", b)).toBe(true);
  });

  it("returns false rather than throwing for a null or malformed hash", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "not-a-real-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$bad$params$here$xx$yy")).toBe(false);
  });

  it("enforces a minimum password length", () => {
    expect(validatePasswordStrength("short").ok).toBe(false);
    expect(validatePasswordStrength("this is long enough").ok).toBe(true);
  });
});

describe("role permissions", () => {
  it("lets operational roles decide review items", () => {
    for (const role of ["ADMIN", "CLOSER", "PROCESSOR", "ATTORNEY"] as const) {
      expect(roleHasPermission(role, "DECIDE_REVIEW_ITEM")).toBe(true);
    }
  });

  it("does NOT let general staff approve AI proposals", () => {
    expect(roleHasPermission("STAFF", "DECIDE_REVIEW_ITEM")).toBe(false);
  });

  it("restricts automation changes to admins", () => {
    expect(roleHasPermission("ADMIN", "MANAGE_AUTOMATION")).toBe(true);
    for (const role of ["CLOSER", "PROCESSOR", "ATTORNEY", "STAFF"] as const) {
      expect(roleHasPermission(role, "MANAGE_AUTOMATION")).toBe(false);
    }
  });

  it("restricts settings changes to admins", () => {
    expect(roleHasPermission("ADMIN", "MANAGE_SETTINGS")).toBe(true);
    expect(roleHasPermission("CLOSER", "MANAGE_SETTINGS")).toBe(false);
  });

  it("allows every role to work tasks", () => {
    for (const role of ["ADMIN", "CLOSER", "PROCESSOR", "ATTORNEY", "STAFF"] as const) {
      expect(roleHasPermission(role, "MANAGE_TASKS")).toBe(true);
    }
  });
});
