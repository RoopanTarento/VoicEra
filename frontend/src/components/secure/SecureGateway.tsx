"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, KeyRound, PhoneOutgoing, ShieldAlert, ShieldX } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { usePermissions } from "@/components/PermissionsProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { listAgents } from "@/lib/api-client";
import type { AgentApiResponse } from "@/lib/api-types";
import { ApiError } from "@/lib/api/http";
import {
  getGatewayActivity,
  listContacts,
  placeSecureCall,
  resolveAsUser,
  resolveWithServiceKey,
  type AuditEvent,
  type GatewayActivity,
  type GatewayCallResult,
  type SecureContact,
} from "@/lib/api/secure";
import {
  ErrorBanner,
  Mono,
  OutcomeBadge,
  SecureHeader,
  SectionTitle,
  ShortId,
  TableShell,
  Td,
  Th,
  errorText,
  formatWhen,
} from "./shared";

const FLOW = [
  { title: "Dispatch by contact ID", body: "Campaign or operator names a CNT- ID. No number in the request or queue." },
  { title: "Authorise", body: "Gateway identity, organisation, contact status and rate limit are checked and audited." },
  { title: "Decrypt in memory", body: "AES-256-GCM ciphertext is opened for this dial only and never stored or logged." },
  { title: "Provider dial", body: "Only the telephony provider receives the destination number." },
  { title: "Sanitise callback", body: "From / To are masked before the hangup event reaches VoicEra." },
];

interface ProbeResult {
  label: string;
  status: number | null;
  message: string;
}

function ContactPicker({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const [contacts, setContacts] = useState<SecureContact[]>([]);
  useEffect(() => {
    listContacts({ status: "active", limit: 100 })
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
  }, []);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a protected contact</option>
      {contacts.map((c) => (
        <option key={c.contact_id} value={c.contact_id}>
          {c.display_name ?? "Unnamed"} · {c.masked_phone} · {c.contact_id.slice(0, 12)}…
        </option>
      ))}
    </Select>
  );
}

function EventRows({ events, empty }: { events: AuditEvent[]; empty: string }) {
  if (events.length === 0) {
    return (
      <tr>
        <Td colSpan={5} className="py-6 text-center text-v-disabled">
          {empty}
        </Td>
      </tr>
    );
  }
  return (
    <>
      {events.slice(0, 12).map((e) => (
        <tr key={e.event_id}>
          <Td className="whitespace-nowrap text-v-muted">{formatWhen(e.created_at)}</Td>
          <Td>
            <ShortId id={e.contact_id} />
          </Td>
          <Td>
            <OutcomeBadge outcome={e.outcome} />
          </Td>
          <Td className="text-xs text-v-muted">{e.actor.id ?? e.actor.type}</Td>
          <Td className="text-xs text-v-muted">
            {e.reason ??
              [e.metadata.provider, e.metadata.call_response, e.metadata.initiated_by]
                .filter(Boolean)
                .map(String)
                .join(" · ")}
          </Td>
        </tr>
      ))}
    </>
  );
}

export function SecureGateway({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const { session } = useAuth();
  const { can } = usePermissions();
  // Dialling a single contact: Super admin only.
  const canDial = can("calls:dial");
  const [agents, setAgents] = useState<AgentApiResponse[]>([]);
  const [agentId, setAgentId] = useState("");
  const [contactId, setContactId] = useState("");
  const [probeContact, setProbeContact] = useState("");
  const [calling, setCalling] = useState(false);
  const [call, setCall] = useState<GatewayCallResult | null>(null);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<GatewayActivity | null>(null);
  const [probes, setProbes] = useState<ProbeResult[]>([]);
  const [probing, setProbing] = useState(false);

  const loadActivity = useCallback(async () => {
    try {
      setActivity(await getGatewayActivity());
    } catch (err) {
      setError(errorText(err, "Couldn't load gateway activity."));
    }
  }, []);

  useEffect(() => {
    void loadActivity();
    listAgents()
      .then((a) => setAgents(a.filter((x) => x.agent_category === "telephony" && x.linked_phone_number && !x.archived)))
      .catch(() => setAgents([]));
  }, [loadActivity]);

  useEffect(() => {
    if (!call) return;
    const id = setInterval(() => void loadActivity(), 2500);
    const stop = setTimeout(() => clearInterval(id), 20000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [call, loadActivity]);

  async function dial() {
    if (!agentId || !contactId) {
      setError("Choose an agent and a contact.");
      return;
    }
    setCalling(true);
    setError("");
    try {
      const r = await placeSecureCall({ agent_id: agentId, contact_id: contactId });
      setCall(r);
      onNotify("Secure call placed", `Dialled ${r.to_number} by contact ID.`);
      void loadActivity();
    } catch (err) {
      setError(errorText(err, "The gateway refused the call."));
    } finally {
      setCalling(false);
    }
  }

  async function probe(kind: "session" | "service") {
    if (!probeContact || !session) return;
    setProbing(true);
    const label = kind === "session" ? "Your dashboard session" : "Unregistered service key";
    try {
      if (kind === "session") await resolveAsUser(probeContact, session.orgId);
      else {
        const key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
        await resolveWithServiceKey(probeContact, session.orgId, "dashboard-probe", key);
      }
      setProbes((p) => [{ label, status: 200, message: "Resolution unexpectedly succeeded" }, ...p].slice(0, 4));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : null;
      setProbes((p) => [{ label, status, message: errorText(err) }, ...p].slice(0, 4));
    } finally {
      setProbing(false);
      void loadActivity();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Secure Gateway"
        description="Outbound calls by contact ID. The gateway is the only component that can decrypt a number, and only for an authorised dial."
        actions={
          activity ? (
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-v-muted">
              Providers:
              {activity.providers.map((p) => (
                <Badge key={p} tone={p === "mock" ? "accent" : "neutral"}>
                  {p}
                </Badge>
              ))}
            </span>
          ) : null
        }
      />

      <div className="grid gap-3 md:grid-cols-5">
        {FLOW.map((step, i) => (
          <Card key={step.title} className="relative flex flex-col gap-1 p-4">
            <span className="font-mono text-[10px] text-v-accent">Step {i + 1}</span>
            <span className="text-[13px] font-semibold">{step.title}</span>
            <span className="text-xs font-light leading-snug text-v-muted">{step.body}</span>
            {i < FLOW.length - 1 ? (
              <ArrowRight className="absolute -right-3 top-1/2 hidden size-4 -translate-y-1/2 text-v-dim md:block" />
            ) : null}
          </Card>
        ))}
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle title="Place a secure call" note="Authorised path: the gateway resolves the number for this dial only." />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gw-agent">Telephony agent</Label>
            <Select id="gw-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Choose an agent</option>
              {agents.map((a) => (
                <option key={a.agent_id} value={a.agent_id}>
                  {a.name} · {a.telephony?.provider}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gw-contact">Contact</Label>
            <ContactPicker id="gw-contact" value={contactId} onChange={setContactId} />
          </div>
          {canDial ? (
            <Button onClick={() => void dial()} disabled={calling}>
              {calling ? <Spinner /> : <PhoneOutgoing className="size-4" strokeWidth={2} />}
              Call by contact ID
            </Button>
          ) : (
            <span className="text-xs text-v-muted">Only the Super admin can dial a single contact.</span>
          )}
          {call ? (
            <div className="grid grid-cols-2 gap-2 rounded-v-md border border-v-line bg-v-surface-sunk p-3 text-xs">
              <span className="text-v-muted">Call ID</span>
              <Mono>{call.call_id.slice(0, 18)}…</Mono>
              <span className="text-v-muted">Destination (as VoicEra stores it)</span>
              <Mono>{call.to_number}</Mono>
              <span className="text-v-muted">Contact</span>
              <ShortId id={call.contact_id} />
              <span className="text-v-muted">Status</span>
              <span>{call.status}</span>
            </div>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle
            title="Test access controls"
            note="Real resolve requests that should be refused. Each attempt is written to the Audit Centre."
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gw-probe-contact">Contact</Label>
            <ContactPicker id="gw-probe-contact" value={probeContact} onChange={setProbeContact} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!probeContact || probing} onClick={() => void probe("session")}>
              <ShieldX className="size-4" strokeWidth={1.8} />
              Resolve with my session
            </Button>
            <Button variant="ghost" disabled={!probeContact || probing} onClick={() => void probe("service")}>
              <KeyRound className="size-4" strokeWidth={1.8} />
              Resolve with an invalid service key
            </Button>
          </div>
          {probes.length ? (
            <ul className="flex flex-col gap-2">
              {probes.map((p, i) => (
                <li
                  key={i}
                  className={`flex items-start gap-2 rounded-v-md border px-3 py-2 text-xs ${
                    p.status === 200 ? "border-v-danger-line bg-v-danger-pale" : "border-v-line bg-v-surface-sunk"
                  }`}
                >
                  <ShieldAlert className={`mt-0.5 size-4 shrink-0 ${p.status === 200 ? "text-v-danger" : "text-v-ok"}`} strokeWidth={1.8} />
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {p.label}: {p.status === 200 ? "allowed" : `refused (HTTP ${p.status ?? "error"})`}
                    </span>
                    <span className="text-v-muted">{p.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-v-disabled">No attempts yet.</span>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <SectionTitle title="Resolution requests" note="Every attempt to turn a contact ID into a number" />
        <TableShell>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Contact</Th>
              <Th>Outcome</Th>
              <Th>Actor</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            <EventRows events={activity?.resolutions ?? []} empty="No resolution requests yet" />
          </tbody>
        </TableShell>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <SectionTitle title="Gateway calls" note="Dials placed by contact ID" />
          <TableShell minWidth={560}>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Contact</Th>
                <Th>Outcome</Th>
                <Th>Actor</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              <EventRows events={activity?.calls ?? []} empty="No gateway calls yet" />
            </tbody>
          </TableShell>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <SectionTitle title="Sanitised callbacks" note="Provider hangup events with From / To masked" />
          <TableShell minWidth={560}>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Contact</Th>
                <Th>Outcome</Th>
                <Th>Actor</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              <EventRows events={activity?.callbacks ?? []} empty="No callbacks yet" />
            </tbody>
          </TableShell>
        </div>
      </div>
    </div>
  );
}
