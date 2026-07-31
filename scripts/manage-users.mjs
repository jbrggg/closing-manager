#!/usr/bin/env node
/**
 * User management CLI — so adding real staff accounts and retiring the demo
 * ones never requires hand-editing the database.
 *
 *   node scripts/manage-users.mjs list
 *   node scripts/manage-users.mjs create "Jane Doe" jane@firm.com ADMIN
 *   node scripts/manage-users.mjs set-password jane@firm.com
 *   node scripts/manage-users.mjs deactivate dana@keystonetitle.com
 *   node scripts/manage-users.mjs activate jane@firm.com
 *
 * NOTE: the scrypt parameters and stored-hash format here must stay in sync
 * with src/lib/auth/password.ts. They are duplicated rather than imported
 * because this script runs outside the Next.js/TypeScript build.
 */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const DB_PATH = path.join(process.cwd(), "db", "app.db");
const SCHEMA_PATH = path.join(process.cwd(), "db", "schema.sql");
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const VALID_ROLES = ["ADMIN", "CLOSER", "PROCESSOR", "ATTORNEY", "STAFF"];

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec(readFileSync(SCHEMA_PATH, "utf-8"));
  return db;
}

async function promptPassword(label) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const value = await rl.question(`${label}: `);
  rl.close();
  if (value.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }
  return value;
}

const [command, ...args] = process.argv.slice(2);
const db = openDb();

switch (command) {
  case "list": {
    const rows = db.prepare(`SELECT name, email, role, isActive, lastLoginAt FROM AppUser ORDER BY role, name`).all();
    if (rows.length === 0) {
      console.log("No users. Start the app once to seed demo data, or run `create`.");
      break;
    }
    for (const u of rows) {
      const status = u.isActive ? "active" : "DISABLED";
      console.log(
        `${u.role.padEnd(10)} ${u.email.padEnd(32)} ${u.name.padEnd(16)} ${status.padEnd(9)} last login: ${u.lastLoginAt ?? "never"}`
      );
    }
    break;
  }

  case "create": {
    const [name, email, role = "STAFF"] = args;
    if (!name || !email) {
      console.error('Usage: create "Full Name" email@firm.com [ROLE]');
      process.exit(1);
    }
    if (!VALID_ROLES.includes(role)) {
      console.error(`Role must be one of: ${VALID_ROLES.join(", ")}`);
      process.exit(1);
    }
    if (db.prepare(`SELECT id FROM AppUser WHERE lower(email) = lower(?)`).get(email)) {
      console.error(`A user with email ${email} already exists.`);
      process.exit(1);
    }
    const org = db.prepare(`SELECT id FROM Organization LIMIT 1`).get();
    if (!org) {
      console.error("No organization found. Start the app once so it seeds, then retry.");
      process.exit(1);
    }
    const password = await promptPassword("New password (min 12 chars)");
    db.prepare(
      `INSERT INTO AppUser (id, organizationId, name, email, role, passwordHash, isActive, lastLoginAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)`
    ).run(randomUUID(), org.id, name, email, role, hashPassword(password), new Date().toISOString());
    console.log(`Created ${role} account for ${email}.`);
    break;
  }

  case "set-password": {
    const [email] = args;
    if (!email) {
      console.error("Usage: set-password email@firm.com");
      process.exit(1);
    }
    const user = db.prepare(`SELECT id FROM AppUser WHERE lower(email) = lower(?)`).get(email);
    if (!user) {
      console.error(`No user with email ${email}.`);
      process.exit(1);
    }
    const password = await promptPassword("New password (min 12 chars)");
    db.prepare(`UPDATE AppUser SET passwordHash = ? WHERE id = ?`).run(hashPassword(password), user.id);
    // Force re-authentication everywhere after a credential change.
    db.prepare(`DELETE FROM Session WHERE userId = ?`).run(user.id);
    console.log(`Password updated for ${email}. All existing sessions revoked.`);
    break;
  }

  case "deactivate":
  case "activate": {
    const [email] = args;
    if (!email) {
      console.error(`Usage: ${command} email@firm.com`);
      process.exit(1);
    }
    const active = command === "activate" ? 1 : 0;
    const result = db.prepare(`UPDATE AppUser SET isActive = ? WHERE lower(email) = lower(?)`).run(active, email);
    if (result.changes === 0) {
      console.error(`No user with email ${email}.`);
      process.exit(1);
    }
    if (!active) {
      const user = db.prepare(`SELECT id FROM AppUser WHERE lower(email) = lower(?)`).get(email);
      db.prepare(`DELETE FROM Session WHERE userId = ?`).run(user.id);
    }
    console.log(`${email} is now ${active ? "active" : "deactivated (sessions revoked)"}.`);
    break;
  }

  default:
    console.log(`Usage:
  node scripts/manage-users.mjs list
  node scripts/manage-users.mjs create "Full Name" email@firm.com [ADMIN|CLOSER|PROCESSOR|ATTORNEY|STAFF]
  node scripts/manage-users.mjs set-password email@firm.com
  node scripts/manage-users.mjs deactivate email@firm.com
  node scripts/manage-users.mjs activate email@firm.com`);
}
