import { all } from "@/lib/db";
import { ensureSeeded } from "@/lib/ensure-seeded";
import { getOfficeDefaults } from "@/lib/services/office-rules";
import { PageHeader, Panel } from "@/components/ui/layout-primitives";
import { StatusChip } from "@/components/ui/status-chip";
import { AutomationRules } from "./automation-rules";
import { requirePageSession } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const officeDefaults = getOfficeDefaults();
  await requirePageSession();
  await ensureSeeded();
  const offices = all<any>(`SELECT * FROM Office`);
  const users = all<any>(`SELECT * FROM AppUser`);
  const emailAccounts = all<any>(`SELECT * FROM EmailAccount`);
  const automationRules = all<any>(`SELECT * FROM AutomationRule ORDER BY actionType`);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Office defaults, users, integrations, and automation posture" />
      <div className="grid grid-cols-1 gap-4 px-6 py-6 lg:grid-cols-2">
        <Panel title="Automation phase (Phase 1 / 2 / 3)">
          <AutomationRules initialRules={JSON.parse(JSON.stringify(automationRules))} />
        </Panel>

        <Panel title="Office defaults (deadline inference)">
          <dl className="divide-y divide-line px-4 py-2 text-[13px]">
            <Row label="Primary timezone" value={officeDefaults.timezone} />
            <Row label="Status-update due window" value={`${officeDefaults.statusUpdateDueHours}h`} />
            <Row label="Urgent lender request due window" value={`${officeDefaults.urgentLenderDueHours}h`} />
            <Row label="Closing-today request due window" value={`${officeDefaults.closingTodayDueMinutes}m`} />
            <Row label="Business hours" value={`${officeDefaults.businessHours.start} – ${officeDefaults.businessHours.end}`} />
          </dl>
        </Panel>

        <Panel title="Offices">
          <div className="divide-y divide-line">
            {offices.map((o) => (
              <div key={o.id} className="px-4 py-2.5 text-[13px]">
                <div className="font-medium text-ink">
                  {o.name} {Boolean(o.isDefault) && <span className="text-[11px] text-ink-muted">(default)</span>}
                </div>
                <div className="text-[11px] text-ink-muted">{o.address}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Users">
          <div className="divide-y divide-line">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                <div>
                  <div className="font-medium text-ink">{u.name}</div>
                  <div className="text-[11px] text-ink-muted">{u.email}</div>
                </div>
                <span className="text-[11px] uppercase tracking-wide text-ink-muted">{u.role}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Email integrations" className="lg:col-span-2">
          <div className="divide-y divide-line">
            {emailAccounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                <div>
                  <div className="font-medium text-ink">{a.emailAddress}</div>
                  <div className="text-[11px] text-ink-muted">
                    Provider: {a.providerType} — mock adapter for this prototype. Gmail and Microsoft 365 adapters
                    plug into the same <code className="font-mono-data">EmailProvider</code> interface.
                  </div>
                </div>
                <StatusChip status={a.connected ? "CONFIRMED" : "CANCELLED"} label={a.connected ? "Connected (mock)" : "Disconnected"} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
