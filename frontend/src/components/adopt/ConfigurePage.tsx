"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormRenderer } from "@/components/adopt/FormRenderer";
import { Notice, Panel } from "@/components/adopt/ui";
import { useWorkspace } from "@/lib/adopt/use-workspace";
import { sectionStatus, validateConfig } from "@/lib/adopt/config-schema";
import { buildValues } from "@/lib/adopt/simulate";

function errorLabel(key: string, labels: Record<string, string>): string {
  return labels[key.split(".")[0]] ?? key;
}

export function ConfigurePage() {
  const { app, ws, actions, state } = useWorkspace();
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    app?.configSections.forEach((s) => s.fields.forEach((f) => (m[f.key] = f.label)));
    return m;
  }, [app]);

  if (!app) return null;
  const result = validateConfig(app, ws.config);
  const errKeys = Object.keys(result.errors);
  const preview = buildValues({ app, config: ws.config, integrations: ws.integrations, packageId: ws.packageId }, {});

  function save() {
    setAttempted(true);
    if (!validateConfig(app!, ws.config).complete) {
      // Bring the first problem into view and focus it.
      requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        first?.scrollIntoView({ block: "center" });
        first?.focus();
      });
      return;
    }
    actions.saveConfig();
  }

  function resetToSample() {
    const defaults: Record<string, unknown> = JSON.parse(JSON.stringify(app!.defaults));
    if (state.answers.department) defaults.department = state.answers.department;
    if (state.answers.languages?.length) defaults.languages = state.answers.languages;
    actions.setConfig(defaults);
    setTouched(new Set());
    setAttempted(false);
    setConfirmReset(false);
  }

  const status = ws.configSaved ? "saved" : result.complete ? "complete" : "incomplete";

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_250px]">
      <div className="min-w-0">
        <div className="mb-6 flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Service configuration</h2>
          <p className="max-w-[62ch] text-[14px] leading-relaxed text-v-body">
            This is everything {app.name} needs from your department. Changes are kept as you type. Save when the
            required fields are right, so the readiness check can count it.
          </p>
        </div>

        {attempted && errKeys.length > 0 ? (
          <div className="mb-6" role="alert">
            <Notice tone="danger" title={`${errKeys.length} ${errKeys.length === 1 ? "thing needs" : "things need"} attention before this can be saved`}>
              <ul className="mt-1 flex flex-col gap-1">
                {errKeys.slice(0, 8).map((k) => (
                  <li key={k}>
                    <a className="underline" href={`#f-${k.split(".")[0]}`}>
                      {errorLabel(k, labels)}
                    </a>
                    : {result.errors[k]}
                  </li>
                ))}
                {errKeys.length > 8 ? <li>and {errKeys.length - 8} more.</li> : null}
              </ul>
            </Notice>
          </div>
        ) : null}

        {ws.configSaved && result.complete ? (
          <div className="mb-6" role="status">
            <Notice tone="info" title="Configuration saved">
              It will be used in the conversation tests and the citizen view.{" "}
              <Link href="/adopt/workspace/test" className="font-semibold underline">Test the conversation</Link>
            </Notice>
          </div>
        ) : null}

        <FormRenderer
          sections={app.configSections}
          config={ws.config}
          onChange={(next) => actions.setConfig(next)}
          errors={result.errors}
          visibleErrors={attempted ? "all" : touched}
          onTouch={(k) => setTouched((t) => (t.has(k) ? t : new Set(t).add(k)))}
          warnings={result.warnings}
        />

        <div className="sticky bottom-0 z-10 mt-10 flex flex-wrap items-center gap-3 border-t border-v-line bg-v-bg/95 py-4 backdrop-blur">
          <Button onClick={save}>Save configuration</Button>
          <span aria-live="polite" className="flex items-center gap-1.5 text-[13px]">
            {status === "saved" ? (
              <>
                <CheckCircle2 className="size-4 text-v-ok" aria-hidden /> <span className="text-v-ok-ink">Saved</span>
              </>
            ) : status === "complete" ? (
              <span className="text-v-body">Complete. Not saved yet.</span>
            ) : (
              <>
                <CircleAlert className="size-4 text-v-warning" aria-hidden />
                <span className="text-v-body">{errKeys.length} to fix before saving</span>
              </>
            )}
          </span>
          <span className="ml-auto">
            {confirmReset ? (
              <span className="flex items-center gap-2 text-[13px]" role="alertdialog" aria-label="Confirm reset to sample content">
                Replace everything with sample content?
                <Button variant="danger-outline" size="sm" onClick={resetToSample}>Replace</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Button>
              </span>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>Reset to sample content</Button>
            )}
          </span>
        </div>
      </div>

      <aside aria-label="Configuration sections and preview" className="flex flex-col gap-5 xl:sticky xl:top-[100px] xl:self-start">
        <nav aria-label="Sections">
          <p className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">Sections</p>
          <ul className="flex flex-col gap-0.5 text-[13px]">
            {app.configSections.map((s) => {
              const ok = sectionStatus(app, s.id, ws.config) === "complete";
              return (
                <li key={s.id}>
                  <a href={`#sec-${s.id}`} className="flex items-center gap-2 rounded-v-md px-2 py-1.5 text-v-body hover:bg-v-soft">
                    <span className={`size-2 shrink-0 rounded-full ${ok ? "bg-v-ok" : "border border-v-line-strong bg-white"}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="sr-only">{ok ? "complete" : "needs attention"}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <Panel className="flex flex-col gap-2 !p-4">
          <p className="font-mono text-[9.5px] uppercase tracking-[.14em] text-v-muted">What the agent opens with</p>
          <p className="text-[13px] leading-relaxed text-v-fg">{preview.greeting}</p>
          <p className="text-[12.5px] leading-relaxed text-v-body">{preview.consentNotice}</p>
          <p className="text-[11.5px] text-v-muted">Updates as you type.</p>
        </Panel>
      </aside>
    </div>
  );
}
