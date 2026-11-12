"use client";

import { AlertCircle, AlertTriangle, Check, CheckCircle2, ChevronDown, Info, Loader2, X, CircleDashed } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ------------------------------------------------------------------ helpers */

const noopSub = () => () => {};
/** True once running in the browser. Avoids a setState-in-effect to detect mounting. */
export function useMounted() { return useSyncExternalStore(noopSub, () => true, () => false); }

export function Portal({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  if (!mounted) return null;
  const root = (document.querySelector(".va") as HTMLElement | null) ?? document.body;
  return createPortal(children, root);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Traps focus in a container, closes on Escape, restores focus on close. */
function useModal(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current(); }
      if (e.key !== "Tab" || !el) return;
      const f = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open, ref]);
}

/* ------------------------------------------------------------------ buttons */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "accent" | "secondary" | "ghost" | "danger" | "danger-quiet"; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode; iconRight?: ReactNode };
export function Button({ variant = "secondary", size = "md", loading, icon, iconRight, className, children, disabled, type = "button", ...rest }: BtnProps) {
  return (
    <button type={type} className={cx("va-btn", `va-btn--${variant}`, size === "sm" && "va-btn--sm", size === "lg" && "va-btn--lg", className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 size={15} className="va-spin" aria-hidden /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
}

export function IconButton({ label, children, size = "md", variant = "ghost", tip = true, ...rest }: Omit<BtnProps, "icon" | "iconRight"> & { label: string; tip?: boolean }) {
  const b = <button type="button" aria-label={label} className={cx("va-btn", `va-btn--${variant}`, "va-btn--icon", size === "sm" && "va-btn--sm")} {...rest}>{children}</button>;
  return tip ? <Tooltip text={label}>{b}</Tooltip> : b;
}

export function Spinner({ size = 16 }: { size?: number }) { return <Loader2 size={size} className="va-spin" aria-label="Loading" role="img" />; }

/* ------------------------------------------------------------------ tooltip */

export function Tooltip({ text, children, side = "top", align = "center" }: { text: string; children: ReactNode; side?: "top" | "right" | "bottom"; align?: "center" | "end" }) {
  const id = useId();
  return (
    <span className="va-tip" data-side={side} data-align={align}>
      <span aria-describedby={id} style={{ display: "inline-flex" }}>{children}</span>
      <span role="tooltip" id={id} className="tip">{text}</span>
    </span>
  );
}

/** A small "i" that explains something. Works with keyboard. */
export function InfoTip({ text, label = "More information" }: { text: string; label?: string }) {
  return (
    <Tooltip text={text}>
      <button type="button" aria-label={label} className="muted" style={{ background: "none", border: 0, padding: 2, display: "inline-flex", cursor: "help" }}>
        <Info size={14} aria-hidden />
      </button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ form fields */

export function Field({ label, help, error, optional, children, htmlFor, className }: { label?: ReactNode; help?: ReactNode; error?: string | null; optional?: boolean; children: (p: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode; htmlFor?: string; className?: string }) {
  const uid = useId();
  const id = htmlFor ?? uid;
  const desc = error ? `${id}-e` : help ? `${id}-h` : undefined;
  return (
    <div className={className}>
      {label && <label className="va-label" htmlFor={id}>{label}{optional && <span className="opt">Optional</span>}</label>}
      {children({ id, "aria-describedby": desc, "aria-invalid": error ? true : undefined })}
      {error ? <p className="va-error" id={`${id}-e`} role="alert"><AlertCircle size={14} className="shrink-0" style={{ marginTop: 2 }} aria-hidden />{error}</p> : help ? <p className="va-help" id={`${id}-h`}>{help}</p> : null}
    </div>
  );
}

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) { return <input className={cx("va-input", className)} {...p} />; }
export function Select({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select className={cx("va-select", className)} {...p}>{children}</select>; }
export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cx("va-textarea", className)} {...p} />; }

/** A number box that accepts commas and clears to empty, which is stored as null. */
export function NumberInput({ value, onChange, unit, min = 0, max, decimals = 0, id, ...rest }: { value: number | null; onChange: (v: number | null) => void; unit?: string; min?: number; max?: number; decimals?: number; id?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max">) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? "" : value.toLocaleString("en-IN", { maximumFractionDigits: decimals }));
  const input = (
    <input id={id} inputMode={decimals ? "decimal" : "numeric"} autoComplete="off" className="va-input tnum" value={shown}
      onFocus={() => setText(value === null ? "" : String(value))}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.]/g, "");
        setText(t);
        if (t === "" || t === ".") return onChange(null);
        let n = Number(t);
        if (!Number.isFinite(n)) return;
        if (decimals === 0) n = Math.round(n);
        if (max !== undefined && n > max) n = max;
        if (n < min) n = min;
        onChange(n);
      }}
      onBlur={() => setText(null)} {...rest} />
  );
  return unit ? <div className="va-unit">{input}<span className="u">{unit}</span></div> : input;
}

export function Checkbox({ label, description, checked, onChange, disabled, name }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; name?: string }) {
  return (
    <label className="va-check">
      <input type="checkbox" name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="ink" style={{ fontWeight: 500 }}>{label}</span>{description && <span className="va-help block" style={{ marginTop: 2 }}>{description}</span>}</span>
    </label>
  );
}

export function Radio({ label, description, checked, onChange, name, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: () => void; name: string; disabled?: boolean }) {
  return (
    <label className="va-check">
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span><span className="ink" style={{ fontWeight: 500 }}>{label}</span>{description && <span className="va-help block" style={{ marginTop: 2 }}>{description}</span>}</span>
    </label>
  );
}

export function Switch({ label, description, checked, onChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-4 cursor-pointer">
      <span><span className="ink block" style={{ fontWeight: 500 }}>{label}</span>{description && <span className="va-help block" style={{ marginTop: 2 }}>{description}</span>}</span>
      <span className="va-switch mt-0.5"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /></span>
    </label>
  );
}

export function SelectCard({ selected, onSelect, title, children, icon, disabled, multi, className }: { selected: boolean; onSelect: () => void; title: ReactNode; children?: ReactNode; icon?: ReactNode; disabled?: boolean; multi?: boolean; className?: string }) {
  return (
    <button type="button" role={multi ? "checkbox" : "radio"} aria-checked={selected} disabled={disabled} onClick={onSelect} className={cx("va-selectcard", className)}>
      <span className="tick">{selected && <Check size={11} strokeWidth={3} aria-hidden />}</span>
      <span className="block pr-6">
        <span className="ink flex items-center gap-2" style={{ fontWeight: 600 }}>{icon && <span className="flex-none" style={{ color: selected ? "var(--ink)" : "var(--muted)" }}>{icon}</span>}{title}</span>
        {children && <span className="block mt-1" style={{ fontSize: 13 }}>{children}</span>}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ status */

export type Tone = "neutral" | "pass" | "warn" | "bad" | "info" | "solid";
export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return <span className={cx("va-badge", tone !== "neutral" && `va-badge--${tone}`)}>{icon}{children}</span>;
}

/** Status is always icon + word, never colour alone. */
export function StatusBadge({ status }: { status: "pass" | "check" | "open" | "accepted" }) {
  if (status === "pass") return <Badge tone="pass" icon={<CheckCircle2 size={12} aria-hidden />}>PASS</Badge>;
  if (status === "accepted") return <Badge tone="info" icon={<Check size={12} aria-hidden />}>ACCEPTED</Badge>;
  if (status === "check") return <Badge tone="warn" icon={<AlertTriangle size={12} aria-hidden />}>CHECK</Badge>;
  return <Badge tone="bad" icon={<CircleDashed size={12} aria-hidden />}>OPEN</Badge>;
}

export function Chip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return <span className="va-chip">{children}{onRemove && <button type="button" onClick={onRemove} aria-label={removeLabel ?? "Remove"}><X size={12} aria-hidden /></button>}</span>;
}

export function Alert({ tone = "info", title, children, action, className, role }: { tone?: "info" | "warn" | "bad" | "pass" | "neutral"; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; role?: "alert" | "status" }) {
  const Icon = tone === "bad" ? AlertCircle : tone === "warn" ? AlertTriangle : tone === "pass" ? CheckCircle2 : Info;
  return (
    <div className={cx("va-alert", tone !== "neutral" && `va-alert--${tone}`, className)} role={role ?? (tone === "bad" ? "alert" : "status")}>
      <Icon size={17} className="ic" aria-hidden />
      <div className="min-w-0 flex-1">{title && <div className="ink" style={{ fontWeight: 600 }}>{title}</div>}{children && <div className={title ? "mt-0.5" : ""}>{children}</div>}{action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}</div>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  return <div className="va-progress" role="progressbar" aria-label={label} aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${v}%` }} /></div>;
}

export const Skeleton = ({ w = "100%", h = 14, className, r }: { w?: number | string; h?: number | string; className?: string; r?: number }) => <div className={cx("va-skel", className)} style={{ width: w, height: h, borderRadius: r }} aria-hidden />;

/* ------------------------------------------------------------------ tabs and segmented */

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (i: number) => { const t = tabs[(i + tabs.length) % tabs.length]; onChange(t.id); refs.current[t.id]?.focus(); };
  return (
    <div className="va-tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" id={`tab-${t.id}`} aria-selected={value === t.id} aria-controls={`panel-${t.id}`} tabIndex={value === t.id ? 0 : -1} className="va-tab" onClick={() => onChange(t.id)}
          onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); move(i + 1); } if (e.key === "ArrowLeft") { e.preventDefault(); move(i - 1); } if (e.key === "Home") { e.preventDefault(); move(0); } if (e.key === "End") { e.preventDefault(); move(tabs.length - 1); } }}>
          {t.label}{t.count !== undefined && <span className="muted tnum" style={{ marginLeft: 6 }}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export const TabPanel = ({ id, active, children }: { id: string; active: boolean; children: ReactNode }) => (active ? <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>{children}</div> : null);

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="va-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}
    </div>
  );
}

/* ------------------------------------------------------------------ menu */

export function Menu({ trigger, children, align = "right", side = "bottom", label }: { trigger: (p: { open: boolean; props: Record<string, unknown> }) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; side?: "top" | "bottom"; label: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    items()[0]?.focus();
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      const list = items(); const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") { setOpen(false); (wrap.current?.querySelector("button") as HTMLElement | null)?.focus(); }
      if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
      if (e.key === "Tab") setOpen(false);
    };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div className="relative inline-block" ref={wrap}>
      {trigger({ open, props: { "aria-haspopup": "menu", "aria-expanded": open, onClick: () => setOpen((o) => !o) } })}
      {open && <div ref={menu} role="menu" aria-label={label} className="va-pop va-fade" style={{ [side === "top" ? "bottom" : "top"]: "calc(100% + 6px)", [align === "right" ? "right" : "left"]: 0 }}>{children(close)}</div>}
    </div>
  );
}
export function MenuItem({ icon, children, onSelect, danger, disabled, href }: { icon?: ReactNode; children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean; href?: string }) {
  const common = { role: "menuitem", className: "va-menuitem", "data-danger": danger ? "" : undefined, "aria-disabled": disabled || undefined, tabIndex: -1 } as const;
  if (href && !disabled) return <a {...common} href={href} onClick={onSelect}>{icon}{children}</a>;
  return <button type="button" {...common} onClick={() => { if (!disabled) onSelect?.(); }}>{icon}{children}</button>;
}

/* ------------------------------------------------------------------ dialog, drawer */

export function Dialog({ open, onClose, title, description, children, footer, wide, dismissable = true }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean; dismissable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useModal(open, dismissable ? onClose : () => {}, ref);
  if (!open) return null;
  return (
    <Portal>
      <div className="va-scrim va-fade" onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}>
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tid} className={cx("va-dialog va-rise", wide && "va-dialog--wide")}>
          <div className="p-5 pb-0 flex items-start justify-between gap-4">
            <div><h2 id={tid} style={{ fontSize: 17 }}>{title}</h2>{description && <p className="mt-1.5 muted" style={{ fontSize: 13.5 }}>{description}</p>}</div>
            {dismissable && <IconButton label="Close" size="sm" onClick={onClose}><X size={16} /></IconButton>}
          </div>
          {children && <div className="p-5">{children}</div>}
          {footer && <div className="px-5 pb-5 flex flex-wrap justify-end gap-2">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export function Drawer({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const tid = useId();
  useModal(open, onClose, ref);
  if (!open) return null;
  return (
    <Portal>
      <div className="va-scrim va-fade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tid} className="va-drawer" style={{ animation: "va-rise 0.3s cubic-bezier(0.22,1,0.36,1) both" }}>
          <div className="p-5 pb-4 flex items-start justify-between gap-4" style={{ borderBottom: "1px solid var(--line)" }}>
            <div><h2 id={tid} style={{ fontSize: 17 }}>{title}</h2>{description && <p className="mt-1.5 muted" style={{ fontSize: 13.5 }}>{description}</p>}</div>
            <IconButton label="Close" size="sm" onClick={onClose}><X size={16} /></IconButton>
          </div>
          <div className="p-5 overflow-y-auto flex-1">{children}</div>
          {footer && <div className="p-4 flex flex-wrap justify-end gap-2" style={{ borderTop: "1px solid var(--line)" }}>{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

/* ------------------------------------------------------------------ collapsible */

export function Disclosure({ summary, children, defaultOpen = false, className }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left" style={{ background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown size={16} className="muted flex-none" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} aria-hidden />
      </button>
      {open && <div id={id} className="va-fade">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ numbers */

/** Animates between numbers. Honours reduced motion. Announces nothing: the surrounding text carries the meaning. */
export function CountUp({ value, format, ms = 600 }: { value: number; format: (n: number) => string; ms?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now(); const a = from.current; const b = value;
    if (reduce || a === b) { from.current = b; raf.current = requestAnimationFrame(() => setShown(b)); return () => cancelAnimationFrame(raf.current); }
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms); const e = 1 - Math.pow(1 - p, 3);
      const v = a + (b - a) * e; from.current = v; setShown(v);
      if (p < 1) raf.current = requestAnimationFrame(tick); else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, ms]);
  return <span className="tnum" aria-hidden>{format(shown)}</span>;
}

export function Logo({ size = 22, withName = true }: { size?: number; withName?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="1" y="1" width="22" height="22" rx="6" fill="var(--solid)" />
        <path d="M5.5 12h2M9 8.5v7M12.5 6v12M16 9v6M19 11v2" stroke="var(--on-solid)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      {withName && <span className="ink" style={{ fontWeight: 650, fontSize: size * 0.68, letterSpacing: "-0.015em" }}>Vani Anuvaad</span>}
    </span>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center mx-auto" style={{ maxWidth: 420, padding: "40px 16px" }}>
      <div className="mx-auto mb-4 grid place-content-center muted" style={{ width: 44, height: 44, borderRadius: 12, border: "1px dashed var(--line-strong)" }}>{icon}</div>
      <h3 style={{ fontSize: 16 }}>{title}</h3>
      {children && <p className="mt-1.5">{children}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
