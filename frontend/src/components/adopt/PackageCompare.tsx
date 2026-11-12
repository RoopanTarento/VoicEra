"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { BulletList } from "@/components/adopt/ui";
import { PACKAGES } from "@/lib/adopt/icp";
import { recommend } from "@/lib/adopt/questionnaire";
import { useAdopt } from "@/lib/adopt/state";
import type { PackageDef } from "@/lib/adopt/types";

type RowDef = { label: string; render: (p: PackageDef) => React.ReactNode };

const ROWS: RowDef[] = [
  { label: "Best for", render: (p) => p.bestFor },
  { label: "Who it is for", render: (p) => p.who },
  { label: "The problem it solves", render: (p) => p.problem },
  { label: "What you can accomplish", render: (p) => <BulletList items={p.accomplish} /> },
  { label: "What you provide", render: (p) => <BulletList items={p.youProvide} /> },
  { label: "What gets configured", render: (p) => <BulletList items={p.weConfigure} /> },
  { label: "Dependencies and approvals", render: (p) => <BulletList items={p.dependencies} /> },
  { label: "Included", render: (p) => <BulletList items={p.included} /> },
  { label: "Not covered", render: (p) => <BulletList items={p.outOfScope} /> },
  { label: "How it connects", render: (p) => p.integration },
  { label: "Typical launch, from the ICP", render: (p) => `${p.typicalLaunch}. A range, not a commitment.` },
  { label: "Next steps", render: (p) => <BulletList items={p.nextSteps} /> },
];

export function PackageCompare() {
  const { state, hydrated } = useAdopt();
  const rec = hydrated ? recommend(state.answers) : null;
  const recommended = state.workspace.packageId ?? rec?.packageId ?? null;

  return (
    <>
      {/* Wide screens: one table so rows line up across packages. */}
      <div className="hidden overflow-hidden rounded-v-xl border border-v-line bg-v-panel shadow-[var(--v-shadow-card)] md:block">
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-v-line bg-v-surface-sunk">
              <td className="w-[170px] px-4 py-4" />
              {PACKAGES.map((p) => (
                <th key={p.id} scope="col" className="px-4 py-4 align-top">
                  <div className="flex items-center gap-2">
                    <Link href={`/adopt/packages/${p.id}`} className="text-lg font-semibold tracking-tight text-v-fg hover:text-v-accent">
                      {p.name}
                    </Link>
                    {recommended === p.id ? <Badge tone="accent">Your plan</Badge> : null}
                  </div>
                  <p className="mt-1 text-[12.5px] font-normal leading-snug text-v-body">{p.positioning}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.label} className="border-b border-v-hairline align-top last:border-0">
                <th scope="row" className="px-4 py-4 text-left font-mono text-[9.5px] font-medium uppercase leading-snug tracking-[.12em] text-v-muted">
                  {r.label}
                </th>
                {PACKAGES.map((p) => (
                  <td key={p.id} className={`px-4 py-4 leading-relaxed text-v-body ${recommended === p.id ? "bg-v-pale/40" : ""}`}>
                    {r.render(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: one package at a time, in the same order. */}
      <div className="flex flex-col gap-4 md:hidden">
        {PACKAGES.map((p) => (
          <details key={p.id} className="group rounded-v-xl border border-v-line bg-v-panel shadow-[var(--v-shadow-card)]" open={p.id === "deploy"}>
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-4">
              <span>
                <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  {p.name}
                  {recommended === p.id ? <Badge tone="accent">Your plan</Badge> : null}
                </span>
                <span className="mt-1 block text-[13px] font-normal leading-snug text-v-body">{p.positioning}</span>
              </span>
              <span className="mt-1 text-[11px] font-semibold text-v-accent group-open:hidden">Open</span>
              <span className="mt-1 hidden text-[11px] font-semibold text-v-accent group-open:inline">Close</span>
            </summary>
            <dl className="flex flex-col gap-4 border-t border-v-line px-4 py-4">
              {ROWS.map((r) => (
                <div key={r.label}>
                  <dt className="font-mono text-[9.5px] uppercase tracking-[.12em] text-v-muted">{r.label}</dt>
                  <dd className="mt-1.5 text-[13.5px] leading-relaxed text-v-body">{r.render(p)}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>
    </>
  );
}
