"use client";

import { Info, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Chip, CountUp, Dialog, Disclosure, Drawer, Empty, Field, IconButton, InfoTip, Input, Menu, MenuItem, NumberInput, Progress, Radio, Segmented, Select, SelectCard, Skeleton, Spinner, StatusBadge, TabPanel, Tabs, Textarea, Tooltip, Switch } from "./ui";
import { Page, PageHeader } from "./page";
import { useVani } from "./provider";
import { inr } from "@/lib/vani/format";

const SWATCHES: [string, string][] = [["--bg", "Page"], ["--surface", "Surface"], ["--sunken", "Sunken"], ["--ink", "Ink"], ["--body", "Body"], ["--muted", "Muted"], ["--line-strong", "Line"], ["--accent", "Accent"], ["--pass", "Pass"], ["--warn", "Warn"], ["--bad", "Bad"]];

const Block = ({ id, title, children, note }: { id: string; title: string; note?: string; children: React.ReactNode }) => (
  <section aria-labelledby={id} className="grid gap-4" style={{ paddingTop: 32, borderTop: "1px solid var(--line)" }}>
    <div><h2 id={id} style={{ fontSize: 17 }}>{title}</h2>{note && <p className="mt-1 muted" style={{ fontSize: 13 }}>{note}</p>}</div>
    {children}
  </section>
);

export function DesignPage() {
  const { toast } = useVani();
  const [tab, setTab] = useState<"a" | "b">("a");
  const [seg, setSeg] = useState<"x" | "y">("x");
  const [dlg, setDlg] = useState(false);
  const [dr, setDr] = useState(false);
  const [card, setCard] = useState("one");
  const [chips, setChips] = useState(["Hindi", "English"]);
  const [n, setN] = useState<number | null>(50000);
  const [on, setOn] = useState(true);
  const [count, setCount] = useState(81025);
  return (
    <Page>
      <PageHeader eyebrow="Design system" title="Components" description="Everything the product is built from. Each one is keyboard accessible, has a visible focus ring, and never relies on colour alone." />
      <div className="grid gap-10">
        <Block id="d-type" title="Typography" note="Newsreader for headings and big numbers, Inter for everything else, JetBrains Mono for identifiers.">
          <div className="va-card va-card--pad grid gap-3"><p className="serif" style={{ fontSize: 44, lineHeight: 1.05, color: "var(--ink)" }}>Design the right package</p><h3 style={{ fontSize: 20 }}>Heading, Inter 600</h3><p>Body text sits at 14 pixels with a 1.5 line height, in a warm grey that keeps long reading comfortable.</p><p className="muted" style={{ fontSize: 12.5 }}>Muted text for help and secondary detail.</p><p className="mono" style={{ fontSize: 13 }}>Q-0001 · v1.2 · asr-sarvam</p></div>
        </Block>
        <Block id="d-col" title="Colour" note="Warm paper and ink. One cobalt accent. Green, amber and red mean pass, check and problem, and nothing else.">
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">{SWATCHES.map(([v, l]) => <div key={v}><div style={{ height: 52, borderRadius: 10, background: `var(${v})`, border: "1px solid var(--line)" }} /><div className="mt-1.5 ink" style={{ fontSize: 12.5, fontWeight: 500 }}>{l}</div><div className="mono muted" style={{ fontSize: 11 }}>{v}</div></div>)}</div>
        </Block>
        <Block id="d-btn" title="Buttons">
          <div className="flex flex-wrap items-center gap-3"><Button variant="primary">Primary</Button><Button variant="accent">Accent</Button><Button>Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button variant="danger-quiet" icon={<Trash2 size={14} />}>Delete</Button><Button loading>Loading</Button><Button disabled>Disabled</Button><Button size="sm">Small</Button><Button size="lg" variant="primary">Large</Button><IconButton label="Information"><Info size={16} /></IconButton></div>
        </Block>
        <Block id="d-form" title="Inputs and choices">
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Text input" help="Help text sits under the field.">{(p) => <Input {...p} placeholder="Type here" />}</Field>
            <Field label="With an error" error="This is what an error looks like.">{(p) => <Input {...p} defaultValue="oops" />}</Field>
            <Field label="Number with a unit">{(p) => <NumberInput {...p} value={n} onChange={setN} unit="calls" />}</Field>
            <Field label="Select">{(p) => <Select {...p}><option>Hindi</option><option>English</option></Select>}</Field>
            <Field label="Text area" className="sm:col-span-2">{(p) => <Textarea {...p} rows={3} />}</Field>
          </div>
          <div className="grid sm:grid-cols-3 gap-5"><Checkbox label="Checkbox" description="A choice you can combine" checked={on} onChange={setOn} /><div className="grid gap-3"><Radio name="r" label="Radio one" checked={card === "one"} onChange={() => setCard("one")} /><Radio name="r" label="Radio two" checked={card === "two"} onChange={() => setCard("two")} /></div><Switch label="Toggle" description="Takes effect at once" checked={on} onChange={setOn} /></div>
          <div className="va-cards"><SelectCard selected={card === "one"} onSelect={() => setCard("one")} title="Select card">Pick one of several, with room to explain.</SelectCard><SelectCard selected={card === "two"} onSelect={() => setCard("two")} title="Another option">Selected cards get a heavier outline and a tick.</SelectCard></div>
          <div className="flex flex-wrap gap-2" aria-label="Chips">{chips.map((c) => <Chip key={c} onRemove={() => setChips((x) => x.filter((y) => y !== c))} removeLabel={`Remove ${c}`}>{c}</Chip>)}{chips.length === 0 && <span className="muted">Chips removed. Reload to see them again.</span>}</div>
        </Block>
        <Block id="d-nav" title="Tabs, segmented control, menus and tooltips">
          <Tabs label="Example tabs" value={tab} onChange={setTab} tabs={[{ id: "a", label: "First", count: 3 }, { id: "b", label: "Second" }]} />
          <TabPanel id="a" active={tab === "a"}><p>Arrow keys move between tabs.</p></TabPanel><TabPanel id="b" active={tab === "b"}><p>Second panel.</p></TabPanel>
          <div className="flex flex-wrap items-center gap-4"><Segmented label="Example" value={seg} onChange={setSeg} options={[{ id: "x", label: "Chart" }, { id: "y", label: "Table" }]} />
            <Menu label="Example menu" trigger={({ props }) => <Button {...props}>Open menu</Button>} align="left">{(close) => <><MenuItem onSelect={close}>First action</MenuItem><MenuItem onSelect={close} disabled>Disabled action</MenuItem><div className="va-menusep" /><MenuItem danger onSelect={close}>Dangerous action</MenuItem></>}</Menu>
            <Tooltip text="Tooltips also appear on keyboard focus."><Button>Hover or focus me</Button></Tooltip><span className="inline-flex items-center gap-1">Info tip <InfoTip text="A short explanation." /></span></div>
        </Block>
        <Block id="d-over" title="Dialogs, drawers and toasts">
          <div className="flex flex-wrap gap-3"><Button onClick={() => setDlg(true)}>Open dialog</Button><Button onClick={() => setDr(true)}>Open drawer</Button><Button onClick={() => toast("Draft saved.", "pass")}>Success toast</Button><Button onClick={() => toast("That didn't work.", "bad")}>Error toast</Button><Button onClick={() => toast("Removed.", "info", { label: "Undo", run: () => toast("Restored.", "pass") })}>Toast with undo</Button></div>
          <Dialog open={dlg} onClose={() => setDlg(false)} title="A dialog" description="Focus is trapped inside. Escape closes it." footer={<><Button onClick={() => setDlg(false)}>Cancel</Button><Button variant="primary" onClick={() => setDlg(false)}>Confirm</Button></>}><p>Dialogs are for decisions that need attention.</p></Dialog>
          <Drawer open={dr} onClose={() => setDr(false)} title="A drawer" description="For longer tasks beside the page."><p>Drawers hold forms and detail without leaving the screen.</p></Drawer>
        </Block>
        <Block id="d-fb" title="Feedback and status">
          <div className="grid gap-3"><Alert tone="info" title="Information">Neutral news.</Alert><Alert tone="pass" title="Success">It worked.</Alert><Alert tone="warn" title="Warning">Look at this before you go on.</Alert><Alert tone="bad" title="Error">Something needs fixing.</Alert></div>
          <div className="flex flex-wrap gap-3 items-center"><StatusBadge status="pass" /><StatusBadge status="check" /><StatusBadge status="open" /><StatusBadge status="accepted" /><Badge tone="solid">Solid</Badge><Badge tone="info">Info</Badge><Badge>Neutral</Badge></div>
          <div className="grid gap-3" style={{ maxWidth: 420 }}><Progress value={62} label="Example progress" /><div className="flex items-center gap-3"><Spinner /> Working</div><Skeleton h={14} /><Skeleton w="60%" h={14} /></div>
          <div className="flex items-baseline gap-4"><span className="serif ink" style={{ fontSize: 36 }}><CountUp value={count} format={(v) => inr(Math.round(v))} /></span><Button size="sm" onClick={() => setCount((c) => (c === 81025 ? 62500 : 81025))}>Change number</Button></div>
        </Block>
        <Block id="d-misc" title="Disclosure and empty state">
          <div className="va-card p-4"><Disclosure summary={<b className="ink">Show more detail</b>}><p className="mt-2">Hidden until asked for.</p></Disclosure></div>
          <div className="va-card"><Empty icon={<Info size={20} />} title="Nothing here yet" action={<Button>Do something</Button>}>Empty states explain what belongs here and offer the next step.</Empty></div>
        </Block>
      </div>
    </Page>
  );
}
