import { randomUUID } from "node:crypto";
import { run, get, resetDb, nowIso } from "@/lib/db";
import { processEmailMessage } from "@/lib/ai/process-email";
import { approveReviewItem } from "@/lib/services/approval";
import { hashPassword } from "@/lib/auth/password";

const ORG_ID = "org-demo";

/** Published demo credential — see README "Human-run setup tasks" before deploying. */
export const DEMO_PASSWORD = "KeystoneDemo2026!";

interface SeedMessageSpec {
  threadId: string;
  threadSubject: string;
  participants: string[];
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  direction: "INCOMING" | "OUTGOING";
  sentAt: string;
  attachment?: { filename: string; mimeType: string; sizeBytes: number };
}

function d(daysFromBase: number, hour = 9): string {
  const base = new Date("2026-07-13T00:00:00.000Z"); // Monday, reference week for seeded history
  const dt = new Date(base);
  dt.setUTCDate(base.getUTCDate() + daysFromBase);
  dt.setUTCHours(hour, 0, 0, 0);
  return dt.toISOString();
}

export function isSeeded(): boolean {
  const row = get<{ id: string }>(`SELECT id FROM Organization WHERE id = ?`, [ORG_ID]);
  return Boolean(row);
}

export async function seedDatabase() {
  resetDb();

  run(`INSERT INTO Organization (id, name, timezone, createdAt) VALUES (?, ?, ?, ?)`, [
    ORG_ID,
    "Keystone Title & Settlement",
    "America/New_York",
    nowIso(),
  ]);

  const officeCH = "office-cherry-hill";
  const officeDT = "office-doylestown";
  run(`INSERT INTO Office (id, organizationId, name, address, isDefault) VALUES (?, ?, ?, ?, 1)`, [
    officeCH,
    ORG_ID,
    "Cherry Hill",
    "1200 Route 70, Cherry Hill, NJ",
  ]);
  run(`INSERT INTO Office (id, organizationId, name, address, isDefault) VALUES (?, ?, ?, ?, 0)`, [
    officeDT,
    ORG_ID,
    "Doylestown",
    "45 Court St, Doylestown, PA",
  ]);

  // Demo accounts. The password is intentionally identical across all three
  // so the demo is easy to walk through — it is hashed with scrypt, never
  // stored in plaintext, but it is still a PUBLISHED credential. The README
  // documents rotating these before any real deployment.
  const userAdmin = "user-admin";
  const userCloser = "user-closer";
  const userProcessor = "user-processor";
  const demoPasswordHash = await hashPassword(DEMO_PASSWORD);

  const demoUsers: { id: string; name: string; email: string; role: string }[] = [
    { id: userAdmin, name: "Dana Reyes", email: "dana@keystonetitle.com", role: "ADMIN" },
    { id: userCloser, name: "Marcus Webb", email: "marcus@keystonetitle.com", role: "CLOSER" },
    { id: userProcessor, name: "Priya Shah", email: "priya@keystonetitle.com", role: "PROCESSOR" },
  ];
  for (const u of demoUsers) {
    run(
      `INSERT INTO AppUser (id, organizationId, name, email, role, passwordHash, isActive, lastLoginAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, NULL, ?)`,
      [u.id, ORG_ID, u.name, u.email, u.role, demoPasswordHash, nowIso()]
    );
  }

  const acctId = "acct-mailbox-1";
  run(
    `INSERT INTO EmailAccount (id, organizationId, providerType, emailAddress, connected, lastSyncedAt) VALUES (?, ?, 'MOCK', ?, 1, ?)`,
    [acctId, ORG_ID, "closings@keystonetitle.com", nowIso()]
  );

  // Phase 2/3 automation rules — seeded DISABLED, which is what makes this a
  // Phase 1 (approval-only) launch. The evaluator in
  // src/lib/services/automation.ts is real and functional; flipping
  // `enabled` to 1 on a row here (or via SQL) activates auto-approval for
  // that action type above its confidence threshold.
  const automationRules: { actionType: string; minConfidence: number }[] = [
    { actionType: "TASK_CREATE", minConfidence: 0.9 },
    { actionType: "TASK_COMPLETE", minConfidence: 0.95 },
    { actionType: "CLOSING_CREATE", minConfidence: 0.95 },
    { actionType: "CLOSING_RESCHEDULE", minConfidence: 0.98 },
    { actionType: "CLOSING_CANCEL", minConfidence: 0.99 },
    { actionType: "TRANSACTION_MERGE", minConfidence: 0.99 },
  ];
  for (const rule of automationRules) {
    run(
      `INSERT INTO AutomationRule (id, actionType, enabled, minConfidence) VALUES (?, ?, 0, ?)`,
      [randomUUID(), rule.actionType, rule.minConfidence]
    );
  }

  // ---------------------------------------------------------------------
  // Build seeded threads/messages for all 7 scenarios
  // ---------------------------------------------------------------------
  const specs: SeedMessageSpec[] = [];

  // Scenario 1 — info spread across separate, differently-subjected email
  specs.push(
    {
      threadId: "t-s1-a",
      threadSubject: "123 Main St — Smith Purchase",
      participants: ["agent.carla@abcrealty.com", "closings@keystonetitle.com"],
      id: "m-s1-a1",
      from: "agent.carla@abcrealty.com",
      to: ["closings@keystonetitle.com"],
      subject: "123 Main St — Smith Purchase",
      body: "John Smith purchase at 123 Main Street. File #FN-2201. Let me know what else you need from us.",
      direction: "INCOMING",
      sentAt: d(0, 9),
    },
    {
      threadId: "t-s1-b",
      threadSubject: "Re: Scheduling",
      participants: ["agent.carla@abcrealty.com", "closings@keystonetitle.com"],
      id: "m-s1-b1",
      from: "agent.carla@abcrealty.com",
      to: ["closings@keystonetitle.com"],
      subject: "Re: Scheduling",
      body: "Friday works for us on the closing.",
      direction: "INCOMING",
      sentAt: d(1, 10),
    },
    {
      threadId: "t-s1-c",
      threadSubject: "Re: Scheduling",
      participants: ["agent.carla@abcrealty.com", "closings@keystonetitle.com"],
      id: "m-s1-c1",
      from: "agent.carla@abcrealty.com",
      to: ["closings@keystonetitle.com"],
      subject: "Re: Scheduling",
      body: "The buyer prefers 2:00 PM if that's still available.",
      direction: "INCOMING",
      sentAt: d(2, 11),
    },
    {
      threadId: "t-s1-d",
      threadSubject: "Office confirmation",
      participants: ["agent.carla@abcrealty.com", "closings@keystonetitle.com"],
      id: "m-s1-d1",
      from: "agent.carla@abcrealty.com",
      to: ["closings@keystonetitle.com"],
      subject: "Office confirmation",
      body: "Closing will be at the Cherry Hill office.",
      direction: "INCOMING",
      sentAt: d(3, 13),
    }
  );

  // Scenario 2 — explicit task request (own transaction: 77 Birchwood Dr)
  specs.push({
    threadId: "t-s2",
    threadSubject: "77 Birchwood Dr — Commitment",
    participants: ["atty.hall@hallesq.com", "closings@keystonetitle.com"],
    id: "m-s2-1",
    from: "atty.hall@hallesq.com",
    to: ["closings@keystonetitle.com"],
    subject: "77 Birchwood Dr — Commitment",
    body:
      "Property: 77 Birchwood Drive, buyer is Karen Ellis. File #FN-3105. Please send the revised commitment by Friday.",
    direction: "INCOMING",
    sentAt: d(0, 8),
  });

  // Scenario 3 — implicit task request (own transaction: 14 Ridgeview Ct)
  specs.push({
    threadId: "t-s3",
    threadSubject: "14 Ridgeview Ct — CPL",
    participants: ["processor@firstnat-lending.com", "closings@keystonetitle.com"],
    id: "m-s3-1",
    from: "processor@firstnat-lending.com",
    to: ["closings@keystonetitle.com"],
    subject: "14 Ridgeview Ct — CPL",
    body:
      "Property at 14 Ridgeview Court, borrower Thomas Reed. Loan #LN-88214. We are still waiting for the CPL and this is holding up underwriting.",
    direction: "INCOMING",
    sentAt: d(1, 9),
  });

  // Scenario 4 — multiple distinct requests in one email (own transaction: 5 Larkspur Ln)
  specs.push({
    threadId: "t-s4",
    threadSubject: "5 Larkspur Ln — Open items",
    participants: ["atty.novak@novaklaw.com", "closings@keystonetitle.com"],
    id: "m-s4-1",
    from: "atty.novak@novaklaw.com",
    to: ["closings@keystonetitle.com"],
    subject: "5 Larkspur Ln — Open items",
    body:
      "Property at 5 Larkspur Lane, buyer Nicole Park. File #FN-4410. Can you send the revised commitment? Please confirm whether the payoff has been ordered. We also need your availability to confirm the closing time this week, please advise.",
    direction: "INCOMING",
    sentAt: d(1, 14),
  });

  // Scenario 5 — reschedule (own transaction: 123 Oak Lane) — initial confirmed
  // closing, then a later email changes the time. We approve the initial
  // closing proposal during seeding so the reschedule has something to
  // supersede, demonstrating superseded-fact history.
  specs.push(
    {
      threadId: "t-s5",
      threadSubject: "123 Oak Lane — Confirmed",
      participants: ["atty.brennan@brennanlaw.com", "closings@keystonetitle.com"],
      id: "m-s5-1",
      from: "atty.brennan@brennanlaw.com",
      to: ["closings@keystonetitle.com"],
      subject: "123 Oak Lane — Confirmed",
      body:
        "Confirming closing at 123 Oak Lane for Diane Torres. File #FN-5002. Monday at 10:00 AM, Doylestown office.",
      direction: "INCOMING",
      sentAt: d(0, 9),
    },
    {
      threadId: "t-s5",
      threadSubject: "123 Oak Lane — Confirmed",
      participants: ["atty.brennan@brennanlaw.com", "closings@keystonetitle.com"],
      id: "m-s5-2",
      from: "atty.brennan@brennanlaw.com",
      to: ["closings@keystonetitle.com"],
      subject: "Re: 123 Oak Lane — Confirmed",
      body: "One change — we now need 123 Oak Lane to move to 3:00 PM, same day, same office.",
      direction: "INCOMING",
      sentAt: d(4, 9),
    }
  );

  // Scenario 6 — ambiguous transaction match (coincidental same full name,
  // unrelated property/file — must NOT auto-merge with Scenario 5's buyer... 
  // we reuse a name that coincidentally matches an unrelated earlier buyer).
  specs.push(
    {
      threadId: "t-s6-a",
      threadSubject: "55 Elm St — Johnson Purchase",
      participants: ["agent.price@price-realty.com", "closings@keystonetitle.com"],
      id: "m-s6-a1",
      from: "agent.price@price-realty.com",
      to: ["closings@keystonetitle.com"],
      subject: "55 Elm St — Johnson Purchase",
      body: "Robert Johnson purchase at 55 Elm Street. File #FN-6010.",
      direction: "INCOMING",
      sentAt: d(0, 9),
    },
    {
      threadId: "t-s6-b",
      threadSubject: "900 Birch Ave — New file",
      participants: ["agent.diaz@diazhomes.com", "closings@keystonetitle.com"],
      id: "m-s6-b1",
      from: "agent.diaz@diazhomes.com",
      to: ["closings@keystonetitle.com"],
      subject: "900 Birch Ave — New file",
      body: "Robert Johnson is the buyer for the property at 900 Birch Avenue. File #FN-7712.",
      direction: "INCOMING",
      sentAt: d(2, 9),
    }
  );

  // Scenario 7 — task completion evidence (own transaction: 200 Sunrise Blvd)
  specs.push(
    {
      threadId: "t-s7",
      threadSubject: "200 Sunrise Blvd — Commitment",
      participants: ["lender.ops@firstnat-lending.com", "closings@keystonetitle.com"],
      id: "m-s7-1",
      from: "lender.ops@firstnat-lending.com",
      to: ["closings@keystonetitle.com"],
      subject: "200 Sunrise Blvd — Commitment",
      body:
        "Property at 200 Sunrise Boulevard, borrower Angela Cruz. Loan #LN-99871. Please send the revised commitment.",
      direction: "INCOMING",
      sentAt: d(0, 9),
    },
    {
      threadId: "t-s7",
      threadSubject: "Re: 200 Sunrise Blvd — Commitment",
      participants: ["lender.ops@firstnat-lending.com", "closings@keystonetitle.com"],
      id: "m-s7-2",
      from: "closings@keystonetitle.com",
      to: ["lender.ops@firstnat-lending.com"],
      subject: "Re: 200 Sunrise Blvd — Commitment",
      body: "Please see attached the revised commitment for your file. Let us know if anything else is needed.",
      direction: "OUTGOING",
      sentAt: d(1, 15),
      attachment: { filename: "Revised_Commitment_FN.pdf", mimeType: "application/pdf", sizeBytes: 182_340 },
    }
  );

  // ---------------------------------------------------------------------
  // Insert threads + messages, then process each message in chronological
  // order (simulating messages arriving over time).
  // ---------------------------------------------------------------------
  const threadsCreated = new Set<string>();
  for (const spec of specs) {
    if (!threadsCreated.has(spec.threadId)) {
      run(`INSERT INTO EmailThread (id, emailAccountId, subject, participants, createdAt) VALUES (?, ?, ?, ?, ?)`, [
        spec.threadId,
        acctId,
        spec.threadSubject,
        JSON.stringify(spec.participants),
        spec.sentAt,
      ]);
      threadsCreated.add(spec.threadId);
    }
  }

  const ordered = [...specs].sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

  for (const spec of ordered) {
    run(
      `INSERT INTO EmailMessage (id, threadId, providerMsgId, fromAddress, toAddresses, subject, bodyText, direction, sentAt, quotedText)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        spec.id,
        spec.threadId,
        `mock-${spec.id}`,
        spec.from,
        JSON.stringify(spec.to),
        spec.subject,
        spec.body,
        spec.direction,
        spec.sentAt,
      ]
    );
    if (spec.attachment) {
      run(
        `INSERT INTO EmailAttachment (id, messageId, filename, mimeType, sizeBytes) VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), spec.id, spec.attachment.filename, spec.attachment.mimeType, spec.attachment.sizeBytes]
      );
    }
  }

  // Process every message through the AI pipeline in the same chronological order.
  for (const spec of ordered) {
    await processEmailMessage(spec.id);

    // Scenario 5 setup: auto-approve the *initial* confirmed closing so the
    // later time-change email produces a genuine reschedule proposal. This
    // approval step simulates a prior human decision made during onboarding,
    // not a Phase-1 automatic action — everything after seeding runs through
    // the normal review queue.
    if (spec.id === "m-s5-1") {
      const pending = get<{ id: string }>(
        `SELECT ri.id as id FROM ReviewItem ri
         JOIN AIProposal p ON p.id = ri.proposalId
         WHERE p.proposalType = 'CLOSING_CREATE' AND ri.status = 'PENDING'
         ORDER BY ri.createdAt DESC LIMIT 1`
      );
      if (pending) {
        approveReviewItem(pending.id, userAdmin);
      }
    }

    // Scenario 7 setup: approve the task-creation proposal from the initial
    // request so a live Task exists for the later outgoing email's
    // completion-evidence detection to match against. Simulates a prior
    // human approval, same rationale as the Scenario 5 setup above.
    if (spec.id === "m-s7-1") {
      const pending = get<{ id: string }>(
        `SELECT ri.id as id FROM ReviewItem ri
         JOIN AIProposal p ON p.id = ri.proposalId
         WHERE p.proposalType = 'TASK_CREATE' AND ri.status = 'PENDING' AND ri.transactionId = (
           SELECT transactionId FROM ExtractedFact WHERE sourceEmailId = 'm-s7-1' AND transactionId IS NOT NULL LIMIT 1
         )
         ORDER BY ri.createdAt DESC LIMIT 1`
      );
      if (pending) {
        approveReviewItem(pending.id, userAdmin);
      }
    }
  }
}
