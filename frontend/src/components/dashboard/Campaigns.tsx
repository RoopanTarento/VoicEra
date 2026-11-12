"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Copy, Download, LayoutGrid, List, Megaphone, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Dialog, DialogHeader } from "@/components/ui/Dialog";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { CampaignAnalysis } from "@/components/dashboard/CampaignAnalysis";
import { CampaignResults } from "@/components/dashboard/CampaignResults";
import { NameField, nameReady } from "@/components/ui/NameField";
import { useCampaigns } from "@/hooks/useCampaigns";
import { usePermissions } from "@/components/PermissionsProvider";
import { getCampaignRuns } from "@/lib/api/campaigns";
import { listContactLists, type ContactList } from "@/lib/api/contact-lists";
import { apiFetchBlob } from "@/lib/api/http";
import { listAgents } from "@/lib/api-client";
import { formatDateTime, maskPhoneNumber } from "@/lib/format";
import { copyName, downloadName, tidyName } from "@/lib/naming";
import type {
  AgentApiResponse,
  CampaignApiResponse,
  CampaignRetryConfig,
  CampaignRunItem,
  CampaignScheduleConfig,
  CampaignScheduleSlot,
  CampaignState,
  CreateCampaignPayload,
} from "@/lib/api-types";

const STATES: CampaignState[] = ["created", "syncing", "running", "paused", "completed", "failed"];
const FILTERS = ["All", ...STATES] as const;
type Filter = (typeof FILTERS)[number];

const TIMEZONE_OPTIONS = [
  { value: "Asia/Kolkata", label: "IST (Asia/Kolkata)" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "Europe/London", label: "Europe/London" },
] as const;

const DEFAULT_RETRY_CONFIG: CampaignRetryConfig = {
  enabled: true,
  max_retries: 2,
  retry_delay_seconds: 120,
  retry_on_busy: true,
  retry_on_no_answer: true,
  retry_on_voicemail: false,
};

/** API slots are per weekday (0=Mon … 6=Sun); expand one daily window to every day. */
function slotsForEveryday(start_time: string, end_time: string): CampaignScheduleSlot[] {
  return Array.from({ length: 7 }, (_, day_of_week) => ({
    day_of_week,
    start_time,
    end_time,
  }));
}

const DEFAULT_SCHEDULE_CONFIG: CampaignScheduleConfig = {
  enabled: false,
  timezone: "Asia/Kolkata",
  slots: slotsForEveryday("09:00", "17:00"),
};

function stateTone(state: CampaignState) {
  if (state === "running") return "live" as const;
  if (state === "completed") return "accent" as const;
  if (state === "syncing") return "accent" as const;
  if (state === "failed") return "danger" as const;
  return "neutral" as const; // created, paused
}

function stateLabel(state: CampaignState) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function progressPct(c: CampaignApiResponse): number {
  if (!c.total_rows) return 0;
  return (c.processed_rows / c.total_rows) * 100;
}

// --- New campaign dialog -----------------------------------------------------

function NewCampaignDialog({
  agents,
  takenNames,
  creating,
  onCreate,
  onClose,
}: {
  agents: AgentApiResponse[];
  /** Existing campaign names: a new one must differ (ignoring case). */
  takenNames: string[];
  creating: boolean;
  onCreate: (payload: CreateCampaignPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState("");
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [rateLimit, setRateLimit] = useState(1);
  const [maxConcurrency, setMaxConcurrency] = useState(5);
  const [retryConfig, setRetryConfig] = useState<CampaignRetryConfig>(DEFAULT_RETRY_CONFIG);
  const [scheduleConfig, setScheduleConfig] = useState<CampaignScheduleConfig>(DEFAULT_SCHEDULE_CONFIG);

  // Contacts come from a list the Super admin uploaded under Contact lists — numbers
  // are already protected there, so creating a campaign never touches a file.
  useEffect(() => {
    let cancelled = false;
    listContactLists()
      .then((res) => {
        if (!cancelled) setLists(res);
      })
      .catch((err) => {
        if (!cancelled) setListsError(err instanceof Error ? err.message : "Couldn't load contact lists.");
      })
      .finally(() => {
        if (!cancelled) setListsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const eligibleAgents = useMemo(
    () => agents.filter((a) => a.agent_category === "telephony" && a.linked_phone_number),
    [agents],
  );
  const usableLists = useMemo(() => lists.filter((l) => l.size > 0), [lists]);
  const scheduleWindow = scheduleConfig.slots[0] ?? { start_time: "09:00", end_time: "17:00" };

  function patchRetry<K extends keyof CampaignRetryConfig>(key: K, value: CampaignRetryConfig[K]) {
    setRetryConfig((prev) => ({ ...prev, [key]: value }));
  }

  function patchScheduleWindow(patch: { start_time?: string; end_time?: string }) {
    setScheduleConfig((prev) => {
      const start = patch.start_time ?? prev.slots[0]?.start_time ?? "09:00";
      const end = patch.end_time ?? prev.slots[0]?.end_time ?? "17:00";
      return { ...prev, slots: slotsForEveryday(start, end) };
    });
  }

  async function confirmCreate() {
    if (!listId || !nameReady(name, takenNames) || !agentId) return;
    const ok = await onCreate({
      name: tidyName(name),
      agent_id: agentId,
      source_type: "secure_contacts",
      source_id: listId,
      rate_limit_per_second: rateLimit,
      max_concurrency: maxConcurrency,
      retry_config: retryConfig,
    });
    if (ok) onClose();
  }

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-2xl">
      <DialogHeader title="New campaign" subtitle="Pick who to call and which agent calls them." onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <NameField
          label="Campaign name"
          value={name}
          onChange={setName}
          taken={takenNames}
          autoFocus
        />

        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Contact list
          <Select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            disabled={listsLoading || usableLists.length === 0}
          >
            <option value="">{listsLoading ? "Loading lists…" : "Select a contact list…"}</option>
            {usableLists.map((l) => (
              <option key={l.list_id} value={l.list_id}>
                {`${l.name} · ${l.size.toLocaleString()} ${l.size === 1 ? "contact" : "contacts"}`}
              </option>
            ))}
          </Select>
          {listsError ? (
            <span className="text-xs font-light text-v-danger">{listsError}</span>
          ) : !listsLoading && usableLists.length === 0 ? (
            <span className="text-xs font-light text-v-muted">
              No contact lists yet —{" "}
              <Link href="/contact-lists" className="font-medium text-v-accent hover:underline">
                upload one under Contact lists
              </Link>{" "}
              first.
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1.5 text-[13px] font-medium">
          Agent
          <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={eligibleAgents.length === 0}>
            <option value="">Select an agent…</option>
            {eligibleAgents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.name}
              </option>
            ))}
          </Select>
          {eligibleAgents.length === 0 ? (
            <span className="text-xs font-light text-v-muted">
              No telephony agent has a linked phone number yet — attach one under Agents first.
            </span>
          ) : null}
        </label>

        <div className="flex flex-col gap-4 rounded-v-md border border-v-line bg-v-soft p-3.5">
          <span className="text-xs font-semibold uppercase tracking-[.08em] text-v-muted">Advanced settings</span>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Calls per second
              <Input
                type="number"
                min={1}
                max={20}
                value={rateLimit}
                onChange={(e) => setRateLimit(Number(e.target.value) || 1)}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium">
              Max concurrent calls
              <Input
                type="number"
                min={1}
                max={20}
                value={maxConcurrency}
                onChange={(e) => setMaxConcurrency(Number(e.target.value) || 1)}
              />
            </label>
          </div>

          <div className="flex flex-col gap-3 border-t border-v-line pt-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold">Retry failed calls</span>
                <span className="text-xs font-light text-v-muted">Re-queue contacts that don't connect.</span>
              </div>
              <Switch
                checked={retryConfig.enabled}
                label="Retry failed calls"
                onChange={(checked) => patchRetry("enabled", checked)}
              />
            </div>

            {retryConfig.enabled ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                    Max retries
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={retryConfig.max_retries}
                      onChange={(e) => patchRetry("max_retries", Math.min(10, Math.max(0, Number(e.target.value) || 0)))}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                    Retry delay (seconds)
                    <Input
                      type="number"
                      min={30}
                      max={3600}
                      value={retryConfig.retry_delay_seconds}
                      onChange={(e) =>
                        patchRetry("retry_delay_seconds", Math.min(3600, Math.max(30, Number(e.target.value) || 30)))
                      }
                    />
                  </label>
                </div>
                <div className="flex flex-col gap-2.5">
                  {(
                    [
                      ["retry_on_busy", "Retry on busy"],
                      ["retry_on_no_answer", "Retry on no answer"],
                      ["retry_on_voicemail", "Retry on voicemail"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-medium">{label}</span>
                      <Switch
                        checked={retryConfig[key]}
                        label={label}
                        onChange={(checked) => patchRetry(key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 border-t border-v-line pt-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold">Calling schedule</span>
                <span className="text-xs font-light text-v-muted">Limit dialling to a daily time window.</span>
              </div>
              <Switch
                checked={scheduleConfig.enabled}
                label="Calling schedule"
                onChange={(checked) => setScheduleConfig((prev) => ({ ...prev, enabled: checked }))}
              />
            </div>

            {scheduleConfig.enabled ? (
              <>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                  Timezone
                  <Select
                    value={scheduleConfig.timezone}
                    onChange={(e) => setScheduleConfig((prev) => ({ ...prev, timezone: e.target.value }))}
                  >
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                    Start
                    <Input
                      type="time"
                      value={scheduleWindow.start_time}
                      onChange={(e) => patchScheduleWindow({ start_time: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-[13px] font-medium">
                    End
                    <Input
                      type="time"
                      value={scheduleWindow.end_time}
                      onChange={(e) => patchScheduleWindow({ end_time: e.target.value })}
                    />
                  </label>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-v-line pt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!nameReady(name, takenNames) || !listId || !agentId || creating}
            onClick={confirmCreate}
          >
            {creating ? <Spinner /> : null}
            Create campaign
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Redial dialog -----------------------------------------------------------

function RedialDialog({
  campaign,
  takenNames,
  busy,
  onConfirm,
  onClose,
}: {
  campaign: CampaignApiResponse | null;
  takenNames: string[];
  busy: boolean;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    // Starts empty: people name redials themselves.
    if (campaign) setName("");
  }, [campaign]);

  return (
    <Dialog open={Boolean(campaign)} onClose={onClose} widthClassName="max-w-sm">
      <DialogHeader title="Redial failed contacts" onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm font-light leading-relaxed text-v-fg">
          Creates a new campaign that redials everyone from{" "}
          <strong className="font-semibold">{campaign?.name}</strong> who didn&apos;t answer.
        </p>
        <NameField label="New campaign name" value={name} onChange={setName} taken={takenNames} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!nameReady(name, takenNames) || busy} onClick={() => onConfirm(tidyName(name))}>
            {busy ? <Spinner /> : null}
            Create redial campaign
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Duplicate dialog -----------------------------------------------------------

function DuplicateDialog({
  campaign,
  takenNames,
  agentName,
  busy,
  onConfirm,
  onClose,
}: {
  campaign: CampaignApiResponse;
  takenNames: string[];
  agentName: string;
  busy: boolean;
  onConfirm: (name: string) => void;
  onClose: () => void;
}) {
  // Rendered (and keyed) per campaign, so the suggested name is set once and typing isn't reset.
  const [name, setName] = useState(() => copyName(campaign.name, takenNames));

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-md">
      <DialogHeader
        title="Duplicate campaign"
        subtitle="A new campaign with the same setup, ready to start."
        onClose={onClose}
      />
      <div className="flex flex-col gap-4 p-5">
        <NameField label="Name of the copy" value={name} onChange={setName} taken={takenNames} autoFocus />
        <div className="grid grid-cols-2 gap-3 rounded-v-md border border-v-line bg-v-soft/40 p-3.5 text-[12.5px]">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">Copied</span>
            <span>Agent: {agentName}</span>
            <span>Contact list</span>
            <span>Pace, retries and schedule</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">Starts fresh</span>
            <span>No calls or results</span>
            <span>Not started</span>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!nameReady(name, takenNames) || busy} onClick={() => onConfirm(tidyName(name))}>
            {busy ? <Spinner /> : <Copy className="size-3.5" strokeWidth={1.8} />}
            Duplicate
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Campaign detail (results + calls) dialog ---------------------------------

/** The report is masked server-side (numbers never leave the API in full). */
async function downloadReport(campaign: CampaignApiResponse) {
  const blob = await apiFetchBlob(`/campaign/${encodeURIComponent(campaign.campaign_id)}/report`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName(campaign.name, "report", "csv");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function CampaignDetailDialog({
  campaign,
  canExport,
  onNotify,
  onClose,
}: {
  campaign: CampaignApiResponse;
  canExport: boolean;
  onNotify: (title: string, note: string) => void;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<CampaignRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCampaignRuns(campaign.campaign_id)
      .then((res) => {
        if (!cancelled) setRuns(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load calls.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campaign.campaign_id]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadReport(campaign);
    } catch (err) {
      onNotify("Couldn't download report", err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-4xl">
      <DialogHeader
        title={campaign.name}
        subtitle={`${stateLabel(campaign.state)} · ${campaign.processed_rows.toLocaleString()} of ${campaign.total_rows.toLocaleString()} contacts placed`}
        titleEnd={
          canExport ? (
            <Button variant="ghost" size="sm" disabled={downloading} onClick={handleDownload}>
              {downloading ? <Spinner light={false} /> : <Download className="size-3.5" strokeWidth={1.75} />}
              Report
            </Button>
          ) : null
        }
        onClose={onClose}
      />
      <div className="flex flex-col gap-6 overflow-y-auto p-5">
        <CampaignResults campaignId={campaign.campaign_id} />

        <section className="flex flex-col gap-3 border-t border-v-line pt-5">
          <span className="text-[15px] font-semibold">Calls</span>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-v-muted">
              <Spinner light={false} /> Loading calls…
            </div>
          ) : error ? (
            <p className="text-sm text-v-danger">{error}</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-v-muted">No calls placed yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-v-md border border-v-line">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-v-line text-left font-mono text-[10px] uppercase tracking-[.1em] text-v-muted">
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Response</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => (
                    <tr key={r.call_id ?? i} className="border-b border-v-line last:border-b-0">
                      <td className="px-4 py-3 font-mono text-xs">{maskPhoneNumber(r.to_number)}</td>
                      <td className="px-4 py-3">{r.status ?? "–"}</td>
                      <td className="px-4 py-3">{r.call_response ?? "–"}</td>
                      <td className="px-4 py-3">{r.duration != null ? `${r.duration}s` : "–"}</td>
                      <td className="px-4 py-3 text-xs text-v-muted">{formatDateTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}

// --- Delete confirmation dialog ----------------------------------------------

function DeleteCampaignDialog({
  campaign,
  busy,
  onConfirm,
  onClose,
}: {
  campaign: CampaignApiResponse | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(campaign)} onClose={onClose} widthClassName="max-w-sm">
      <DialogHeader title="Delete campaign?" onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm font-light leading-relaxed text-v-fg">
          Are you sure you want to delete <strong className="font-semibold">{campaign?.name}</strong>? This
          can&apos;t be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger-outline" size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? <Spinner light={false} /> : null}
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Main page ---------------------------------------------------------------

export function Campaigns({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const { can } = usePermissions();
  // Only the Super admin creates/deletes campaigns (they hold the contact lists);
  // running them and downloading masked reports is shared with Admins and
  // Campaign managers. Everyone else just views.
  const canWrite = can("campaigns:write");
  const canRun = can("campaigns:run");
  const canExport = can("campaigns:export");
  const {
    campaigns,
    loading,
    loadError,
    creating,
    busyId,
    create,
    start,
    pause,
    resume,
    redial,
    duplicate,
    remove,
  } = useCampaigns(onNotify);
  const canAnalyse = can("analytics:read");
  const [view, setView] = useState<"campaigns" | "analysis">("campaigns");
  const [duplicateTarget, setDuplicateTarget] = useState<CampaignApiResponse | null>(null);
  const takenNames = useMemo(() => campaigns.map((c) => c.name), [campaigns]);
  const [agents, setAgents] = useState<AgentApiResponse[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [layout, setLayout] = useState<"cards" | "list">("cards");
  const [createOpen, setCreateOpen] = useState(false);
  const [redialTarget, setRedialTarget] = useState<CampaignApiResponse | null>(null);
  const [detailTarget, setDetailTarget] = useState<CampaignApiResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampaignApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAgents()
      .then((res) => {
        if (!cancelled) setAgents(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const agentNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents) map[a.agent_id] = a.name;
    return map;
  }, [agents]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: campaigns.length };
    for (const camp of campaigns) c[camp.state] = (c[camp.state] ?? 0) + 1;
    return c;
  }, [campaigns]);

  const rows = filter === "All" ? campaigns : campaigns.filter((c) => c.state === filter);

  const stats = useMemo(() => {
    const totalContacts = campaigns.reduce((sum, c) => sum + c.total_rows, 0);
    const running = campaigns.filter((c) => c.state === "running").length;
    const completed = campaigns.filter((c) => c.state === "completed").length;
    return { total: campaigns.length, running, totalContacts, completed };
  }, [campaigns]);

  function actionFor(c: CampaignApiResponse) {
    if (!canRun) return null;
    const busy = busyId === c.campaign_id;
    if (c.state === "created") {
      return (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => start(c.campaign_id)}>
          {busy ? <Spinner light={false} /> : null}
          Start
        </Button>
      );
    }
    if (c.state === "running") {
      return (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => pause(c.campaign_id)}>
          {busy ? <Spinner light={false} /> : null}
          Pause
        </Button>
      );
    }
    if (c.state === "paused") {
      return (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => resume(c.campaign_id)}>
          {busy ? <Spinner light={false} /> : null}
          Resume
        </Button>
      );
    }
    if (c.state === "completed" || c.state === "failed") {
      return (
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRedialTarget(c)}>
          Redial
        </Button>
      );
    }
    return (
      <Button variant="ghost" size="sm" disabled>
        Syncing…
      </Button>
    );
  }

  function controlsFor(c: CampaignApiResponse) {
    return (
      <span className="flex items-center gap-1.5">
        <Tooltip text="View results and calls">
          <IconButton
            aria-label="View results and calls"
            onClick={() => setDetailTarget(c)}
            className="bg-v-soft hover:border-v-accent hover:bg-v-pale hover:text-v-accent"
          >
            <List className="size-4" strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
        {canWrite ? (
          <Tooltip text="Duplicate campaign">
            <IconButton
              aria-label="Duplicate campaign"
              onClick={() => setDuplicateTarget(c)}
              className="bg-v-soft hover:border-v-accent hover:bg-v-pale hover:text-v-accent"
            >
              <Copy className="size-4" strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        ) : null}
        {canWrite ? (
          <Tooltip text="Delete campaign">
            <IconButton
              aria-label="Delete campaign"
              onClick={() => setDeleteTarget(c)}
              className="bg-v-soft hover:border-v-danger-line hover:bg-v-danger-pale hover:text-v-danger"
            >
              <Trash2 className="size-4" strokeWidth={1.75} />
            </IconButton>
          </Tooltip>
        ) : null}
        {actionFor(c)}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-v-line pb-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Campaigns</h1>
          <p className="max-w-[64ch] text-sm font-light leading-relaxed text-v-muted">
            Calls you make, not calls you take — a campaign is a telephony agent plus a list of
            people.
          </p>
        </div>
        {canWrite ? (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            + New campaign
          </Button>
        ) : null}
      </div>

      {canAnalyse ? (
        <div role="tablist" aria-label="Campaign views" className="flex w-fit gap-1 rounded-full border border-v-line bg-white p-1">
          {(
            [
              ["campaigns", "Campaigns", Megaphone],
              ["analysis", "Analysis & calendar", CalendarDays],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
                view === id ? "bg-v-fg text-white" : "text-v-muted-2 hover:bg-v-soft"
              }`}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {view === "analysis" && canAnalyse ? (
        <CampaignAnalysis campaigns={campaigns} agentNameById={agentNameById} onNotify={onNotify} />
      ) : (
      <>

      {loadError ? (
        <div className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-sm text-v-danger">
          {loadError}
        </div>
      ) : null}

      {!loading && campaigns.length > 0 ? (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          <StatCard label="Campaigns" value={String(stats.total)} />
          <StatCard label="Running now" value={String(stats.running)} />
          <StatCard label="Contacts queued" value={stats.totalContacts.toLocaleString()} />
          <StatCard label="Completed" value={String(stats.completed)} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium capitalize ${
                filter === f ? "border-v-fg bg-v-fg text-white" : "border-v-line bg-white text-v-muted-2 hover:border-v-accent"
              }`}
            >
              {f} {counts[f] ? <span className="ml-1 opacity-70">{counts[f]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-full border border-v-line bg-white">
          <button
            type="button"
            onClick={() => setLayout("cards")}
            aria-label="Grid view"
            className={`cursor-pointer px-3 py-2 transition-colors ${
              layout === "cards" ? "bg-v-fg text-white" : "text-v-muted-2 hover:bg-v-soft"
            }`}
          >
            <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={() => setLayout("list")}
            aria-label="List view"
            className={`cursor-pointer px-3 py-2 transition-colors ${
              layout === "list" ? "bg-v-fg text-white" : "text-v-muted-2 hover:bg-v-soft"
            }`}
          >
            <List className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-v-muted">
          <Spinner light={false} /> Loading campaigns…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-v-md border border-dashed border-v-line bg-white p-12 text-center">
          <span className="text-sm font-semibold">
            {filter === "All" ? "No campaigns yet" : "Nothing matches"}
          </span>
          <span className="text-xs font-light text-v-muted">
            {filter !== "All"
              ? "Try another filter."
              : canWrite
                ? "Pick a contact list and an agent to start your first campaign."
                : "Your Super admin creates campaigns from the organisation's contact lists."}
          </span>
        </div>
      ) : layout === "cards" ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <div key={c.campaign_id} className="flex flex-col gap-3.5 rounded-v-md border border-v-line bg-white p-4.5">
              <Badge tone={stateTone(c.state)}>{stateLabel(c.state)}</Badge>
              <span className="flex flex-col gap-1 min-w-0">
                <span className="truncate text-[15px] font-semibold">{c.name}</span>
                <span className="text-xs font-light text-v-muted">
                  {agentNameById[c.agent_id] ?? c.agent_id}
                </span>
              </span>
              <div className="flex flex-col gap-1.5">
                <ProgressBar pct={progressPct(c)} thick />
                <span className="flex items-center justify-between text-[10.5px] font-mono text-v-muted">
                  <span>
                    {c.processed_rows.toLocaleString()} of {c.total_rows ? c.total_rows.toLocaleString() : "–"} placed
                  </span>
                  <span>{c.failed_rows.toLocaleString()} failed</span>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-v-line pt-3">
                <span className="font-mono text-[10.5px] text-v-muted">
                  {formatDateTime(c.started_at ?? c.created_at)}
                </span>
                {controlsFor(c)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col rounded-v-md border border-v-line bg-white">
          {rows.map((c) => (
            <div key={c.campaign_id} className="flex flex-wrap items-center justify-between gap-3 border-b border-v-line px-4.5 py-3 last:border-0">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13.5px] font-medium">{c.name}</span>
                <span className="text-xs font-light text-v-muted">
                  {agentNameById[c.agent_id] ?? c.agent_id} · {formatDateTime(c.started_at ?? c.created_at)}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="w-24">
                  <ProgressBar pct={progressPct(c)} />
                </span>
                <span className="font-mono text-[10.5px] w-16 text-right text-v-muted">
                  {Math.round(progressPct(c))}%
                </span>
                <Badge tone={stateTone(c.state)}>{stateLabel(c.state)}</Badge>
                {controlsFor(c)}
              </span>
            </div>
          ))}
        </div>
      )}

      </>
      )}

      {createOpen && canWrite ? (
        <NewCampaignDialog
          agents={agents}
          takenNames={takenNames}
          creating={creating}
          onCreate={create}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}

      {duplicateTarget ? (
        <DuplicateDialog
          key={duplicateTarget.campaign_id}
          campaign={duplicateTarget}
          takenNames={takenNames}
          agentName={agentNameById[duplicateTarget.agent_id] ?? duplicateTarget.agent_id}
          busy={busyId === duplicateTarget.campaign_id}
          onConfirm={async (name) => {
            const ok = await duplicate(duplicateTarget.campaign_id, name);
            if (ok) setDuplicateTarget(null);
          }}
          onClose={() => setDuplicateTarget(null)}
        />
      ) : null}

      <RedialDialog
        campaign={redialTarget}
        takenNames={takenNames}
        busy={busyId === redialTarget?.campaign_id}
        onConfirm={async (name) => {
          if (!redialTarget) return;
          const ok = await redial(redialTarget.campaign_id, name);
          if (ok) setRedialTarget(null);
        }}
        onClose={() => setRedialTarget(null)}
      />

      {detailTarget ? (
        <CampaignDetailDialog
          key={detailTarget.campaign_id}
          campaign={detailTarget}
          canExport={canExport}
          onNotify={onNotify}
          onClose={() => setDetailTarget(null)}
        />
      ) : null}

      <DeleteCampaignDialog
        campaign={deleteTarget}
        busy={busyId === deleteTarget?.campaign_id}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const ok = await remove(deleteTarget.campaign_id);
          if (ok) setDeleteTarget(null);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
