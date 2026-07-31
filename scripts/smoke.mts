/**
 * SMOKE CHECK — does the running app actually work?
 *
 *   npm run dev        (in one terminal)
 *   npm run smoke      (in another)
 *
 * Signs in as the demo user and walks the path in NEXT-STEPS step 2:
 * every screen, approve one review item, change an office setting and change
 * it back. It talks to the app over HTTP exactly as the browser does.
 *
 * WHAT THIS IS NOT
 *
 * It is not a look at the screens. It proves every page returns a real signed-in
 * page rather than an error or a bounce to the login form, and that the actions
 * behind the buttons do what they claim. It cannot tell you a button is
 * invisible, overlapping, or mislabelled. A human still has to look once.
 *
 * Nothing here is destructive: the one setting it changes is put back, and the
 * review item it approves is the kind of decision the demo data exists for.
 */
const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL ?? "dana@keystonetitle.com";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "KeystoneDemo2026!";

const SCREENS = ["/", "/board", "/review", "/transactions", "/tasks", "/settings", "/activity", "/lab"];

let cookie = "";
let failures = 0;

function ok(label: string, detail = "") {
  console.log(`  OK    ${label}${detail ? ` — ${detail}` : ""}`);
}
function bad(label: string, detail: string) {
  failures++;
  console.log(`  FAIL  ${label} — ${detail}`);
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return res;
}

async function main() {
  console.log(`Smoke-checking ${BASE}\n`);

  // --- can we get in at all? -------------------------------------------------
  console.log("Signing in");
  const login = await call("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    bad("sign in", `${login.status} ${await login.text()}`);
    console.log("\nNothing else can be checked without a session. Is `npm run dev` running?");
    process.exit(1);
  }
  const me = (await (await call("/api/v1/auth/me")).json()) as { user?: { name: string; role: string } };
  if (!me.user) bad("sign in", "no user came back");
  else ok("signed in", `${me.user.name}, ${me.user.role}`);

  // --- does every screen render for a signed-in user? ------------------------
  console.log("\nEvery screen");
  for (const path of SCREENS) {
    const res = await call(path);
    const html = await res.text();
    if (!res.ok) bad(path, `HTTP ${res.status}`);
    // A page that quietly hands back the login form is the failure that looks
    // like a pass in a status-code-only check.
    else if (html.includes('autocomplete="current-password"')) bad(path, "bounced to the login form");
    else ok(path, `${html.length} bytes`);
  }
}

interface ReviewItem {
  id: string;
  status: string;
  reviewType: string;
  transactionId: string | null;
  propertyAddress: string | null;
  duplicateCandidates: string[] | null;
  decidedByUserId: string | null;
}
const reviewItems = async (status = "PENDING") =>
  ((await (await call(`/api/v1/review-items?status=${status}`)).json()) as { reviewItems: ReviewItem[] }).reviewItems;

async function checkApproval() {
  console.log("\nApproving one review item");
  const pending = await reviewItems();
  const item = pending[0];
  if (!item) return ok("approve", "nothing pending to approve — skipped");

  const res = await call(`/api/v1/review-items/${item.id}/approve`, { method: "POST", body: "{}" });
  if (!res.ok) return bad("approve", `HTTP ${res.status} ${await res.text()}`);

  const stillPending = await reviewItems();
  const approved = (await reviewItems("APPROVED")).find((r) => r.id === item.id);
  if (!approved) return bad("approve", "the item did not move to APPROVED");
  if (stillPending.length !== pending.length - 1) bad("approve", "the pending count did not go down by one");
  // Invariant 5: attribution comes from the session, never a request body.
  if (!approved.decidedByUserId) bad("approve", "nothing was recorded as having decided it");
  else ok("approve", `${item.reviewType} on ${item.propertyAddress ?? "an unnamed file"}, decided by ${approved.decidedByUserId}`);
  ok("pending count", `${pending.length} → ${stillPending.length}`);
}

interface Settings {
  officeDefaults: { statusUpdateDueHours: number };
}
const settings = async () => (await (await call("/api/v1/settings")).json()) as Settings;

async function checkSettingsPersist() {
  console.log("\nOffice settings survive a save (roadmap D2)");
  const before = (await settings()).officeDefaults.statusUpdateDueHours;
  const target = before === 6 ? 5 : 6;

  const res = await call("/api/v1/settings", {
    method: "PATCH",
    body: JSON.stringify({ officeDefaults: { statusUpdateDueHours: target } }),
  });
  if (!res.ok) return bad("save settings", `HTTP ${res.status}`);

  const saved = (await settings()).officeDefaults.statusUpdateDueHours;
  if (saved !== target) bad("save settings", `asked for ${target}, read back ${saved}`);
  else ok("save settings", `${before} → ${saved}`);

  await call("/api/v1/settings", {
    method: "PATCH",
    body: JSON.stringify({ officeDefaults: { statusUpdateDueHours: before } }),
  });
  const restored = (await settings()).officeDefaults.statusUpdateDueHours;
  if (restored !== before) bad("restore settings", `left it on ${restored} instead of ${before}`);
  else ok("restore settings", `back to ${restored}`);
}

async function checkMergeButton() {
  console.log("\nThe merge button (roadmap D1)");
  // The two-step merge button only appears on a review item carrying a
  // duplicate candidate. Report honestly whether the demo data can show it —
  // an untestable button is worth saying out loud, not skipping silently.
  const withDuplicates = (await reviewItems()).filter((r) => r.duplicateCandidates?.length);
  if (withDuplicates.length === 0) {
    console.log(
      "  SKIP  no review item is flagged as a possible duplicate, so the Merge button\n" +
        "        is not on screen and cannot be exercised. That is not proof it works.\n" +
        "        See ROADMAP D1 and `npm run diagnose` — two emails about one property\n" +
        "        score 0 rather than 45 when the address comes back at different levels\n" +
        "        of detail ('88 Wren Hollow Rd' vs '88 Wren Hollow Rd, Trenton NJ'),\n" +
        "        and the flag needs 15."
    );
    return;
  }

  const item = withDuplicates[0];
  const primary = item.transactionId!;
  const secondary = item.duplicateCandidates![0];

  // Step one of the button: show what would move, before anything moves.
  const preview = await call(`/api/v1/transactions/${primary}/merge`, {
    method: "POST",
    body: JSON.stringify({ secondaryTransactionId: secondary, dryRun: true }),
  });
  if (!preview.ok) bad("merge preview", `HTTP ${preview.status} ${await preview.text()}`);
  else ok("merge preview", JSON.stringify((await preview.json()).preview).slice(0, 160));
}

await main();
await checkApproval();
await checkSettingsPersist();
await checkMergeButton();

console.log(
  failures === 0
    ? "\nEverything the smoke check can reach is working. Someone still has to look at the screens once."
    : `\n${failures} check(s) failed. Read the FAIL lines above.`
);
process.exit(failures === 0 ? 0 : 1);
