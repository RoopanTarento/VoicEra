"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { AvailabilityPill, Notice, Panel } from "@/components/adopt/ui";
import { useWorkspace } from "@/lib/adopt/use-workspace";
import type { IntegrationEntry, KnowledgeSourceEntry, PackageId } from "@/lib/adopt/types";

const PKG_RANK: Record<PackageId, number> = { deploy: 0, connect: 1, orchestrate: 2 };
const HTTPS = /^https:\/\/[^\s/$.?#][^\s]*$/i;

const AUTH = [
  "Not decided yet",
  "Token held by your IT team",
  "OAuth",
  "Basic authentication",
  "Mutual TLS",
];

function blankIntegration(id: string): IntegrationEntry {
  return { id, status: "not-started", endpoint: "", authMethod: "Not decided yet", owner: "", notes: "" };
}

export function KnowledgePage() {
  const { app, ws, actions } = useWorkspace();
  const [newName, setNewName] = useState("");
  const [newErr, setNewErr] = useState<string | null>(null);
  const [intErr, setIntErr] = useState<Record<string, string>>({});
  if (!app) return null;
  const pkg = (ws.packageId ?? app.recommendedPackage) as PackageId;

  const setK = (i: number, patch: Partial<KnowledgeSourceEntry>) =>
    actions.setKnowledge(ws.knowledge.map((k, j) => (j === i ? { ...k, ...patch } : k)));

  function addSource() {
    const name = newName.trim();
    if (name.length < 3) {
      setNewErr("Give the source a name of at least 3 characters.");
      return;
    }
    if (ws.knowledge.some((k) => k.name.toLowerCase() === name.toLowerCase())) {
      setNewErr("A source with that name is already listed.");
      return;
    }
    actions.setKnowledge([...ws.knowledge, { id: `k${Date.now()}`, name, kind: "Added by you", status: "draft", notes: "" }]);
    setNewName("");
    setNewErr(null);
  }

  function setInteg(id: string, patch: Partial<IntegrationEntry>) {
    const cur = ws.integrations[id] ?? blankIntegration(id);
    const next = { ...cur, ...patch };
    // A status beyond "not started" needs real details.
    if (patch.status && patch.status !== "not-started") {
      const problems: string[] = [];
      if (!HTTPS.test(next.endpoint.trim())) problems.push("a valid https address");
      if (next.owner.trim().length < 3) problems.push("the person who owns it");
      if (problems.length) {
        setIntErr((e) => ({ ...e, [id]: `Add ${problems.join(" and ")} first.` }));
        return;
      }
    }
    setIntErr((e) => {
      const { [id]: _drop, ...rest } = e;
      void _drop;
      return rest;
    });
    actions.setIntegration(next);
  }

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="k-head" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="k-head" className="text-xl font-semibold tracking-tight">Knowledge sources</h2>
          <p className="max-w-[62ch] text-[14px] leading-relaxed text-v-body">
            The agent only speaks from content someone has approved. Track each source here and who has signed it off.
            Uploading and indexing the actual documents happens in the Knowledge Base in the VoicERA console, which
            takes PDF files today.
          </p>
          <Link href="/knowledge-base" className="self-start text-[13px] font-semibold text-v-accent hover:underline">
            Open the Knowledge Base in the console
          </Link>
        </div>

        <ul className="flex flex-col gap-3">
          {ws.knowledge.map((k, i) => {
            const idBase = `k-${k.id}`;
            const added = k.kind === "Added by you";
            return (
              <li key={k.id}>
                <Panel className="flex flex-col gap-4 !p-4 md:!p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{k.name}</p>
                      <p className="font-mono text-[9.5px] uppercase tracking-[.12em] text-v-muted">
                        {k.kind}
                        {!added && app.knowledge[i] ? ` · ${app.knowledge[i].detail}` : ""}
                      </p>
                    </div>
                    {added ? (
                      <button
                        type="button"
                        onClick={() => actions.setKnowledge(ws.knowledge.filter((_, j) => j !== i))}
                        aria-label={`Remove ${k.name}`}
                        className="flex size-9 items-center justify-center rounded-v-md border border-v-line text-v-muted hover:border-v-danger hover:text-v-danger"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${idBase}-status`} className="text-[12.5px] font-semibold">Status</label>
                      <Select id={`${idBase}-status`} value={k.status} onChange={(e) => setK(i, { status: e.target.value as KnowledgeSourceEntry["status"] })}>
                        <option value="draft">Draft</option>
                        <option value="in-review">With the approver</option>
                        <option value="approved">Approved</option>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${idBase}-notes`} className="text-[12.5px] font-semibold">Notes (who approved it, version, source document)</label>
                      <Textarea id={`${idBase}-notes`} rows={2} value={k.notes} maxLength={300} onChange={(e) => setK(i, { notes: e.target.value })} />
                    </div>
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addSource();
          }}
        >
          <label htmlFor="k-new" className="text-[13px] font-semibold">Add another source</label>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-[240px] flex-1">
              <Input
                id="k-new"
                value={newName}
                maxLength={80}
                placeholder="For example, State agriculture handbook 2026"
                aria-invalid={newErr ? true : undefined}
                aria-describedby={newErr ? "k-new-err" : undefined}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewErr(null);
                }}
              />
              {newErr ? <p id="k-new-err" role="alert" className="mt-1 text-[12.5px] font-medium text-v-danger">{newErr}</p> : null}
            </div>
            <Button type="submit" variant="outline">
              <Plus className="size-3.5" aria-hidden /> Add
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="s-head" className="flex flex-col gap-4 border-t border-v-line pt-10">
        <div className="flex flex-col gap-1.5">
          <h2 id="s-head" className="text-xl font-semibold tracking-tight">Systems to connect</h2>
          <p className="max-w-[62ch] text-[14px] leading-relaxed text-v-body">
            Record what your IT team has agreed for each system. This is the brief the implementation team starts from.
            Nothing is connected from here.
          </p>
        </div>
        <Notice tone="warning" title="Never enter keys, passwords or tokens here">
          Credentials are set up separately, by your IT team and the implementation team. This page only records the
          address, the method and who is responsible.
        </Notice>

        <ul className="flex flex-col gap-4">
          {app.integrations.map((i) => {
            const entry = ws.integrations[i.id] ?? blankIntegration(i.id);
            const minRank = Math.min(...i.forPackage.map((p) => PKG_RANK[p]));
            const outOfPackage = PKG_RANK[pkg] < minRank;
            const err = intErr[i.id];
            return (
              <li key={i.id}>
                <Panel className="flex flex-col gap-4 !p-4 md:!p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">{i.name}</p>
                      <p className="text-[13px] text-v-body">{i.purpose}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[.12em] text-v-muted">
                        {i.need === "required" ? "Needed" : i.need === "optional" ? "Optional" : "Not needed"}
                      </span>
                      <AvailabilityPill value={i.platform} />
                    </div>
                  </div>
                  {outOfPackage ? (
                    <Notice tone="info">This is not part of the {pkg[0].toUpperCase() + pkg.slice(1)} package, so nothing is needed here unless you change package.</Notice>
                  ) : null}
                  <p className="text-[12.5px] leading-relaxed text-v-muted">{i.platformNote}</p>
                  <fieldset disabled={outOfPackage} className="grid gap-4 md:grid-cols-2 disabled:opacity-50">
                    <legend className="sr-only">{i.name} details</legend>
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label htmlFor={`i-${i.id}-endpoint`} className="text-[12.5px] font-semibold">Address (https)</label>
                      <Input
                        id={`i-${i.id}-endpoint`}
                        value={entry.endpoint}
                        placeholder="https://grievance.example.gov.in/api"
                        maxLength={200}
                        onChange={(e) => actions.setIntegration({ ...entry, endpoint: e.target.value })}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `i-${i.id}-err` : undefined}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`i-${i.id}-auth`} className="text-[12.5px] font-semibold">How access is controlled</label>
                      <Select id={`i-${i.id}-auth`} value={entry.authMethod} onChange={(e) => actions.setIntegration({ ...entry, authMethod: e.target.value })}>
                        {AUTH.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`i-${i.id}-owner`} className="text-[12.5px] font-semibold">Owner on your IT team</label>
                      <Input id={`i-${i.id}-owner`} value={entry.owner} maxLength={80} onChange={(e) => actions.setIntegration({ ...entry, owner: e.target.value })} aria-invalid={err ? true : undefined} />
                    </div>
                    <div className="flex flex-col gap-1.5 md:col-span-2">
                      <label htmlFor={`i-${i.id}-status`} className="text-[12.5px] font-semibold">Status</label>
                      <div className="max-w-[360px]">
                        <Select id={`i-${i.id}-status`} value={entry.status} onChange={(e) => setInteg(i.id, { status: e.target.value as IntegrationEntry["status"] })}>
                          <option value="not-started">Not started</option>
                          <option value="details-entered">Details entered</option>
                          <option value="reviewed">Reviewed by the IT owner</option>
                        </Select>
                      </div>
                      {err ? <p id={`i-${i.id}-err`} role="alert" className="text-[12.5px] font-medium text-v-danger">{err}</p> : null}
                    </div>
                    <div className="md:col-span-2">
                      <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Your IT team provides</p>
                      <ul className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-v-body">
                        {i.inputs.map((x) => (
                          <li key={x}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  </fieldset>
                </Panel>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
