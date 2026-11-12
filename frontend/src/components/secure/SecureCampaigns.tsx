"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Lock, LockOpen, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, StatCard } from "@/components/ui/Card";
import { Dialog, DialogHeader } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { usePermissions } from "@/components/PermissionsProvider";
import { listAgents } from "@/lib/api-client";
import { createCampaign, startCampaign } from "@/lib/api/campaigns";
import type { AgentApiResponse } from "@/lib/api-types";
import {
  createContactSet,
  getCampaignProtection,
  listBatches,
  type BatchSummary,
  type CampaignProtectionRow,
  type ContactSet,
  type OrgPolicy,
} from "@/lib/api/secure";
import {
  EmptyState,
  ErrorBanner,
  Loading,
  Mono,
  SecureHeader,
  SectionTitle,
  TableShell,
  Td,
  Th,
  errorText,
  formatWhen,
} from "./shared";

function NewSecureCampaign({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string, started: boolean) => void;
}) {
  const [agents, setAgents] = useState<AgentApiResponse[]>([]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [source, setSource] = useState("all");
  const [rate, setRate] = useState("5");
  const [concurrency, setConcurrency] = useState("5");
  const [startNow, setStartNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    listAgents()
      .then((a) => setAgents(a.filter((x) => x.agent_category === "telephony" && x.linked_phone_number && !x.archived)))
      .catch(() => setAgents([]));
    listBatches()
      .then((b) => setBatches(b.filter((x) => x.status === "tokenized")))
      .catch(() => setBatches([]));
  }, [open]);

  async function submit() {
    if (!name.trim() || !agentId) {
      setError("Give the campaign a name and choose a telephony agent.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const set = await createContactSet({
        name: name.trim(),
        ...(source === "all" ? { all_active: true } : { batch_id: source }),
      });
      const campaign = await createCampaign({
        name: name.trim(),
        agent_id: agentId,
        source_type: "secure_contacts",
        source_id: set.set_id,
        rate_limit_per_second: Number(rate) || 1,
        max_concurrency: Number(concurrency) || 1,
      });
      if (startNow) await startCampaign(campaign.campaign_id);
      onCreated(campaign.name, startNow);
      setName("");
      onClose();
    } catch (err) {
      setError(errorText(err, "The campaign couldn't be created."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} widthClassName="max-w-lg">
      <DialogHeader
        title="New secure campaign"
        subtitle="Queued calls carry contact IDs only. Numbers are decrypted by the gateway at dial time."
        onClose={onClose}
      />
      <div className="flex flex-col gap-4 px-5 py-5">
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="secure-campaign-name">Campaign name</Label>
          <Input id="secure-campaign-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Scheme awareness, wave 1" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="secure-campaign-agent">Telephony agent</Label>
          <Select id="secure-campaign-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Choose an agent</option>
            {agents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.name} · {a.telephony?.provider ?? "telephony"}
              </option>
            ))}
          </Select>
          {agents.length === 0 ? (
            <span className="text-xs text-v-muted">No telephony agent with an attached number. Create one under Agents first.</span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="secure-campaign-source">Contacts</Label>
          <Select id="secure-campaign-source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">Every active contact in the vault</option>
            {batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>
                {b.filename} · {b.result?.created ?? 0} contacts · {formatWhen(b.tokenized_at)}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="secure-campaign-rate">Calls per second</Label>
            <Input id="secure-campaign-rate" type="number" min={1} max={20} value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="secure-campaign-concurrency">Max concurrent calls</Label>
            <Input
              id="secure-campaign-concurrency"
              type="number"
              min={1}
              max={20}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
          </div>
        </div>
        <span className="flex items-center gap-2 text-sm text-v-body">
          <Switch checked={startNow} onChange={setStartNow} label="Start immediately" />
          Start immediately
        </span>
        <div className="flex justify-end gap-2 border-t border-v-line pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : null}
            Create campaign
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function SecureCampaigns({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const router = useRouter();
  const { can } = usePermissions();
  const canCreate = can("campaigns:write");
  const [rows, setRows] = useState<CampaignProtectionRow[]>([]);
  const [sets, setSets] = useState<ContactSet[]>([]);
  const [policy, setPolicy] = useState<OrgPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getCampaignProtection();
      setError("");
      setRows(r.campaigns);
      setSets(r.contact_sets);
      setPolicy(r.policy);
    } catch (err) {
      setError(errorText(err, "Couldn't load campaign protection."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount / filter change; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    if (!rows.some((r) => r.state === "running" || r.state === "syncing")) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [rows, load]);

  const stats = useMemo(
    () => ({
      protectedCount: rows.filter((r) => r.protected).length,
      legacy: rows.filter((r) => !r.protected).length,
      plaintext: rows.reduce((n, r) => n + r.plaintext_queue_entries, 0),
      calls: rows.reduce((n, r) => n + r.calls_tokenised, 0),
    }),
    [rows],
  );

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Campaign Security"
        description="Which campaigns dial by contact ID and which still carry plaintext numbers in their queue. New campaigns created here use the vault."
        actions={
          canCreate ? (
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" strokeWidth={2} />
              New secure campaign
            </Button>
          ) : null
        }
      />
      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard label="Vault campaigns" value={String(stats.protectedCount)} note="Dial by contact ID" />
        <StatCard label="Legacy CSV" value={String(stats.legacy)} note="Numbers in the queue" />
        <StatCard label="Plaintext queued" value={stats.plaintext.toLocaleString()} note="From legacy campaigns" />
        <StatCard label="Calls by ID" value={stats.calls.toLocaleString()} note="Placed through the gateway" />
      </div>

      {policy ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <span className="flex items-center gap-2 text-sm text-v-body">
            {policy.require_vault_campaigns ? (
              <Lock className="size-4 text-v-ok" strokeWidth={2} />
            ) : (
              <LockOpen className="size-4 text-v-warn" strokeWidth={2} />
            )}
            {policy.require_vault_campaigns
              ? "Vault-only policy is on: plain CSV campaigns are rejected."
              : "Plain CSV campaigns are still allowed in this organisation."}
          </span>
          <Button variant="ghost" size="sm" onClick={() => router.push("/secure/settings")}>
            Change policy
          </Button>
        </Card>
      ) : null}

      {loading && rows.length === 0 ? (
        <Loading label="Loading campaigns" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-8" strokeWidth={1.5} />}
          title="No campaigns yet"
          body="Create a secure campaign from tokenised contacts. Its queue, retries and redials will hold contact IDs only."
          action={canCreate ? <Button onClick={() => setOpen(true)}>New secure campaign</Button> : undefined}
        />
      ) : (
        <TableShell minWidth={900}>
          <thead>
            <tr>
              <Th>Campaign</Th>
              <Th>Protection</Th>
              <Th>State</Th>
              <Th>Contacts</Th>
              <Th>Dial attempts</Th>
              <Th>Calls</Th>
              <Th>Plaintext in queue</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.campaign_id}>
                <Td className="font-medium">{r.name}</Td>
                <Td className="whitespace-nowrap">
                  {r.protected ? <Badge tone="live">Contact IDs</Badge> : <Badge tone="warn">Plain CSV</Badge>}
                </Td>
                <Td>
                  <Badge tone={r.state === "running" ? "accent" : r.state === "failed" ? "danger" : "neutral"}>{r.state}</Badge>
                </Td>
                <Td className="text-xs text-v-muted">
                  {r.contact_set ? (
                    <>
                      {r.contact_set.size} in <Mono title={r.contact_set.set_id}>{r.contact_set.name}</Mono>
                    </>
                  ) : (
                    `${r.total_rows} CSV rows`
                  )}
                </Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {r.processed_rows}
                  <span className="text-v-muted"> incl. retries</span>
                  {r.failed_rows ? <span className="text-v-danger"> · {r.failed_rows} gave up</span> : null}
                </Td>
                <Td className="tabular-nums text-v-muted">
                  {r.calls}
                  {r.calls ? ` (${r.calls_tokenised} by ID)` : ""}
                </Td>
                <Td className={`tabular-nums ${r.plaintext_queue_entries ? "font-semibold text-v-warn-ink" : "text-v-muted"}`}>
                  {r.plaintext_queue_entries}
                </Td>
                <Td className="whitespace-nowrap text-v-muted">{formatWhen(r.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      {sets.length ? (
        <div className="flex flex-col gap-3">
          <SectionTitle title="Contact sets" note="Groups of vault contacts used as campaign sources" />
          <TableShell minWidth={560}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Set ID</Th>
                <Th>Contacts</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.set_id}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>
                    <Mono>{s.set_id}</Mono>
                  </Td>
                  <Td className="tabular-nums">{s.size}</Td>
                  <Td className="text-v-muted">
                    {formatWhen(s.created_at)} · {s.created_by}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </div>
      ) : null}

      <NewSecureCampaign
        key={open ? "open" : "closed"}
        open={open}
        onClose={() => setOpen(false)}
        onCreated={(name, started) => {
          onNotify(started ? "Campaign started" : "Campaign created", `${name} dials by contact ID through the secure gateway.`);
          void load();
        }}
      />
    </div>
  );
}
