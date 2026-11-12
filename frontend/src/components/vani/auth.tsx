"use client";

import { ArrowLeft, Check, Eye, EyeOff, Inbox, Lock, Mail, MailCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import * as api from "@/lib/vani/api";
import { isEmail, passwordStrength } from "@/lib/vani/auth";
import { ROLES } from "@/lib/vani/rbac";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/lib/vani/seed";
import { messageOf, useVani } from "./provider";
import { Alert, Button, Checkbox, Field, Input, Logo, Select, Spinner, cx } from "./ui";

export function AuthShell({ title, subtitle, children, aside = true }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: boolean }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="flex flex-col px-5 sm:px-10 py-6">
        <Link href="/vani" style={{ textDecoration: "none" }} aria-label="Vani Anuvaad home"><Logo /></Link>
        <main id="main" className="flex-1 grid place-items-center py-10">
          <div className="w-full va-rise" style={{ maxWidth: 400 }}>
            <h1 className="serif" style={{ fontSize: 34, lineHeight: 1.1, color: "var(--ink)" }}>{title}</h1>
            {subtitle && <p className="mt-3">{subtitle}</p>}
            <div className="mt-8">{children}</div>
          </div>
        </main>
        <p className="muted" style={{ fontSize: 12 }}>Prototype with sample data. Nothing you enter leaves this browser.</p>
      </div>
      {aside && (
        <aside className="hidden lg:flex flex-col justify-between p-12" style={{ background: "var(--sunken)", borderLeft: "1px solid var(--line)" }} aria-hidden>
          <p className="eyebrow">Why teams use it</p>
          <div>
            <p className="serif" style={{ fontSize: 30, lineHeight: 1.25, color: "var(--ink)", maxWidth: 440 }}>We stopped guessing which stack to buy and started comparing evidence.</p>
            <p className="mt-4 muted" style={{ fontSize: 12.5 }}>Illustrative example of the kind of outcome the product is designed for.</p>
          </div>
          <ul className="m-0 p-0 list-none grid gap-3" style={{ fontSize: 13.5 }}>
            {["Every recommendation shows its reasons", "Data rules checked before you submit", "A quote you can send for approval"].map((t) => (
              <li key={t} className="flex items-center gap-3"><Check size={16} className="ink" />{t}</li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

export function PasswordField({ id, value, onChange, label = "Password", autoComplete, error, help, describedBy, showStrength }: { id?: string; value: string; onChange: (v: string) => void; label?: string; autoComplete: string; error?: string | null; help?: ReactNode; describedBy?: string; showStrength?: boolean }) {
  const [show, setShow] = useState(false);
  const s = passwordStrength(value);
  return (
    <div>
      <Field label={label} error={error} help={help} htmlFor={id}>
        {(p) => (
          <div className="va-affix">
            <Input {...p} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} aria-describedby={[p["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined} style={{ paddingLeft: 12, paddingRight: 44 }} />
            <span className="post"><button type="button" className="va-btn va-btn--ghost va-btn--sm va-btn--icon" aria-pressed={show} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((x) => !x)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>
          </div>
        )}
      </Field>
      {showStrength && value && (
        <div className="mt-2.5" id={describedBy}>
          <div className="flex gap-1" aria-hidden>{[0, 1, 2, 3].map((i) => <span key={i} className="flex-1" style={{ height: 3, borderRadius: 2, background: i < s.score ? (s.score <= 1 ? "var(--bad)" : s.score === 2 ? "var(--warn)" : "var(--ink)") : "var(--line-strong)", transition: "background 0.2s" }} />)}</div>
          <p className="mt-1.5" style={{ fontSize: 12.5 }} aria-live="polite"><span className="ink" style={{ fontWeight: 500 }}>{s.label}.</span> {s.hints.length ? s.hints.slice(0, 2).join(". ") + "." : "Good password."}</p>
        </div>
      )}
    </div>
  );
}

/** Stands in for the email that would be sent. Clearly labelled, because no email leaves the browser. */
function DemoInbox({ email, kinds, label }: { email: string; kinds: ("verify" | "reset")[]; label: string }) {
  const router = useRouter();
  const [items, setItems] = useState<{ kind: string; token: string }[] | null>(null);
  useEffect(() => { let live = true; void api.demoInbox(email).then((x) => { if (live) setItems(x.filter((i) => (kinds as string[]).includes(i.kind))); }); return () => { live = false; }; }, [email, kinds]);
  if (!items) return null;
  const last = items[items.length - 1];
  if (!last) return null;
  return (
    <div className="mt-6 p-4" style={{ border: "1px dashed var(--line-strong)", borderRadius: 12 }}>
      <p className="eyebrow flex items-center gap-1.5"><Inbox size={13} aria-hidden /> Prototype inbox</p>
      <p className="mt-1.5" style={{ fontSize: 13 }}>No real email is sent from this prototype. This button stands in for the link in that email.</p>
      <Button className="mt-3" size="sm" onClick={() => router.push(last.kind === "verify" ? `/vani/verify?token=${last.token}` : `/vani/reset?token=${last.token}`)}>{label}</Button>
    </div>
  );
}

/* ------------------------------------------------------------------ sign in */

function SignInInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { refresh, status } = useVani();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [remember, setRemember] = useState(false);
  const [err, setErr] = useState<{ code?: string; message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState("product_manager");
  const [resent, setResent] = useState(false);
  const next = sp.get("next");

  useEffect(() => { if (status === "authed") router.replace(next && next.startsWith("/vani/") ? next : "/vani/app"); }, [status, next, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      await api.signIn({ email, password: pw, remember });
      await refresh();
      router.replace(next && next.startsWith("/vani/") ? next : "/vani/app");
    } catch (x) {
      setErr(x instanceof api.ApiError ? { code: x.code, message: x.message, field: x.field } : { message: messageOf(x) });
    } finally { setBusy(false); }
  };
  const notice = sp.get("expired") ? { tone: "info" as const, t: "Your session ended. Sign in to pick up where you left off." } : sp.get("signedout") ? { tone: "pass" as const, t: "You're signed out." } : sp.get("reset") ? { tone: "pass" as const, t: "Password changed. Sign in with the new one." } : sp.get("verified") ? { tone: "pass" as const, t: "Email verified. You can sign in now." } : sp.get("denied") ? { tone: "warn" as const, t: "Sign in to view that page." } : null;

  return (
    <AuthShell title="Sign in" subtitle={<>New here? <Link href="/vani/signup">Create an account</Link></>}>
      {notice && <Alert tone={notice.tone} className="mb-5">{notice.t}</Alert>}
      <form onSubmit={submit} noValidate className="grid gap-5">
        {err && (
          <Alert tone="bad" title={err.code === "locked" ? "Account locked for now" : err.code === "network" ? "Can't reach the server" : err.code === "unverified" ? "Verify your email first" : "Couldn't sign you in"}
            action={err.code === "unverified" ? <><Button size="sm" onClick={async () => { await api.resendVerification(email); setResent(true); }}>Send a new link</Button>{resent && <span style={{ fontSize: 12.5 }}>New link ready below.</span>}</> : err.code === "network" ? <Button size="sm" onClick={(e) => submit(e as unknown as FormEvent)}>Try again</Button> : undefined}>{err.message}</Alert>
        )}
        {err?.code === "unverified" && isEmail(email) && <DemoInbox email={email} kinds={["verify"]} label="Open the verification link" key={String(resent)} />}
        <Field label="Work email" error={err?.field === "email" ? err.message : null}>
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="name@department.gov.in" required />}
        </Field>
        <PasswordField value={pw} onChange={setPw} autoComplete="current-password" error={err?.field === "password" ? err.message : null} />
        <div className="flex items-center justify-between gap-4">
          <Checkbox label="Keep me signed in" checked={remember} onChange={setRemember} />
          <Link href="/vani/forgot" style={{ fontSize: 13 }}>Forgot password?</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" loading={busy}>{busy ? "Signing in" : "Sign in"}</Button>
      </form>

      <div className="mt-8 p-4" style={{ border: "1px dashed var(--line-strong)", borderRadius: 12 }}>
        <p className="eyebrow flex items-center gap-1.5"><Lock size={13} aria-hidden /> Prototype demo accounts</p>
        <p className="mt-1.5" style={{ fontSize: 13 }}>Pick a role to fill the form. Each role sees different permissions.</p>
        <div className="mt-3 flex gap-2">
          <Select aria-label="Demo role" value={role} onChange={(e) => setRole(e.target.value)} style={{ height: 34 }}>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
          <Button size="sm" style={{ height: 34 }} onClick={() => { const a = DEMO_ACCOUNTS.find((x) => x.role === role); if (a) { setEmail(a.email); setPw(DEMO_PASSWORD); setErr(null); } }}>Fill sign in</Button>
        </div>
      </div>
    </AuthShell>
  );
}
export const SignIn = () => <Suspense fallback={null}><SignInInner /></Suspense>;

/* ------------------------------------------------------------------ sign up */

export function SignUp() {
  const [f, setF] = useState({ name: "", email: "", org: "", password: "", confirm: "", terms: false });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [serverErr, setServerErr] = useState<{ field?: string; message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; joined: boolean; role: string } | null>(null);
  const set = (k: keyof typeof f) => (v: string | boolean) => { setF((x) => ({ ...x, [k]: v })); if (serverErr?.field === k) setServerErr(null); };
  const check = (k: string): string | null => {
    if (k === "name" && f.name.trim().length < 2) return "Enter your full name.";
    if (k === "email" && !isEmail(f.email)) return "Enter a valid work email, like name@department.gov.in.";
    if (k === "org" && f.org.trim().length < 2) return "Enter your organisation's name.";
    if (k === "password" && passwordStrength(f.password).score < 3) return "Choose a stronger password. See the hints below.";
    if (k === "confirm" && f.confirm !== f.password) return "The two passwords don't match.";
    if (k === "terms" && !f.terms) return "Accept the terms to continue.";
    return null;
  };
  const err = (k: string): string | null => {
    if (serverErr?.field === k) return serverErr.message;
    return touched[k] || touched.all ? check(k) : null;
  };
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched({ all: true }); setServerErr(null);
    if (["name", "email", "org", "password", "confirm", "terms"].some((k) => check(k) !== null)) return;
    setBusy(true);
    try {
      const r = await api.signUp({ name: f.name, email: f.email, password: f.password, confirm: f.confirm, org: f.org, terms: f.terms });
      setDone({ email: r.email, joined: r.joinedExisting, role: r.role });
    } catch (x) {
      setServerErr(x instanceof api.ApiError ? { field: x.field, message: x.message, code: x.code } : { message: messageOf(x) });
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <AuthShell title="Check your email" subtitle={<>We sent a link to <b className="ink">{done.email}</b>. Open it to verify your address, then sign in.</>} aside={false}>
        <Alert tone="pass" title="Account created">{done.joined ? "You joined an existing organisation as a Viewer. An admin can change your role." : "You are the admin of your new organisation."}</Alert>
        <DemoInbox email={done.email} kinds={["verify"]} label="Open the verification link" />
        <p className="mt-6" style={{ fontSize: 13 }}>Wrong address? <button className="va-link" onClick={() => setDone(null)}>Go back</button></p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Create your account" subtitle={<>Already have one? <Link href="/vani/signin">Sign in</Link></>}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        {serverErr && !serverErr.field && <Alert tone="bad" title="Couldn't create the account">{serverErr.message}</Alert>}
        <Field label="Full name" error={err("name")}>{(p) => <Input {...p} value={f.name} onChange={(e) => set("name")(e.target.value)} onBlur={blur("name")} autoComplete="name" />}</Field>
        <Field label="Work email" error={err("email")}>
          {(p) => <Input {...p} type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} onBlur={blur("email")} autoComplete="email" placeholder="name@department.gov.in" />}
        </Field>
        {serverErr?.code === "duplicate" && <p style={{ fontSize: 13, marginTop: -8 }}><Link href="/vani/signin">Sign in</Link> or <Link href="/vani/forgot">reset your password</Link>.</p>}
        <Field label="Organisation" error={err("org")} help="Your department or company. If it already exists you will join it as a Viewer.">{(p) => <Input {...p} value={f.org} onChange={(e) => set("org")(e.target.value)} onBlur={blur("org")} autoComplete="organization" />}</Field>
        <PasswordField value={f.password} onChange={(v) => set("password")(v)} autoComplete="new-password" error={err("password")} showStrength describedBy="pw-strength" />
        <PasswordField label="Confirm password" value={f.confirm} onChange={(v) => set("confirm")(v)} autoComplete="new-password" error={err("confirm")} />
        <div>
          <Checkbox checked={f.terms} onChange={(v) => { set("terms")(v); blur("terms")(); }} label={<>I accept the terms of use and privacy notice</>} />
          {err("terms") && <p className="va-error" role="alert">{err("terms")}</p>}
        </div>
        <Button type="submit" variant="primary" size="lg" loading={busy}>{busy ? "Creating account" : "Create account"}</Button>
      </form>
    </AuthShell>
  );
}

/* ------------------------------------------------------------------ verify */

function VerifyInner() {
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "bad">(token ? "working" : "bad");
  const [msg, setMsg] = useState("This link is missing its code.");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!token) return;
    let live = true;
    api.verifyEmail(token).then(() => { if (live) setState("ok"); }).catch((e) => { if (live) { setState("bad"); setMsg(messageOf(e)); } });
    return () => { live = false; };
  }, [token]);
  if (state === "working") return <AuthShell title="Verifying" aside={false}><div className="flex items-center gap-3"><Spinner />Checking your link</div></AuthShell>;
  if (state === "ok") return <AuthShell title="Email verified" subtitle="Your account is ready." aside={false}><Link href="/vani/signin?verified=1" className="va-btn va-btn--primary va-btn--lg w-full">Continue to sign in</Link></AuthShell>;
  return (
    <AuthShell title="Link not valid" aside={false}>
      <Alert tone="bad">{msg}</Alert>
      <form className="mt-6 grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (!isEmail(email)) return; await api.resendVerification(email); setSent(true); }}>
        <Field label="Email for a new link">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Button type="submit" variant="primary">Send a new link</Button>
        {sent && <><Alert tone="pass">If that account needs verifying, a new link is ready.</Alert><DemoInbox email={email} kinds={["verify"]} label="Open the verification link" /></>}
      </form>
    </AuthShell>
  );
}
export const Verify = () => <Suspense fallback={null}><VerifyInner /></Suspense>;

/* ------------------------------------------------------------------ forgot, reset */

export function Forgot() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (!isEmail(email)) { setErr("Enter a valid email address."); return; }
    setBusy(true);
    try { await api.requestReset(email); setSent(true); } catch (x) { setErr(messageOf(x)); } finally { setBusy(false); }
  };
  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle={<>If an account exists for <b className="ink">{email}</b>, a reset link is on its way. It works once and expires in an hour.</>} aside={false}>
        <p style={{ fontSize: 13 }}>We don&apos;t say whether an address has an account. That keeps the list private.</p>
        <DemoInbox email={email} kinds={["reset"]} label="Open the reset link" />
        <Link href="/vani/signin" className="mt-6 inline-flex items-center gap-1.5" style={{ fontSize: 13 }}><ArrowLeft size={14} /> Back to sign in</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Reset your password" subtitle="Enter your work email and we'll send a link." aside={false}>
      <form onSubmit={submit} noValidate className="grid gap-5">
        <Field label="Work email" error={err}>{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="name@department.gov.in" />}</Field>
        <Button type="submit" variant="primary" size="lg" loading={busy} icon={<Mail size={16} />}>Send reset link</Button>
        <Link href="/vani/signin" className="inline-flex items-center gap-1.5" style={{ fontSize: 13 }}><ArrowLeft size={14} /> Back to sign in</Link>
      </form>
    </AuthShell>
  );
}

function ResetInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const token = sp.get("token") ?? "";
  const [pw, setPw] = useState(""); const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<{ field?: string; message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await api.resetPassword(token, pw, confirm); setOk(true); } catch (x) { setErr(x instanceof api.ApiError ? { field: x.field, message: x.message, code: x.code } : { message: messageOf(x) }); } finally { setBusy(false); }
  };
  if (ok) return <AuthShell title="Password changed" subtitle="Sign in with your new password. Other sessions were ended." aside={false}><Button variant="primary" size="lg" className="w-full" icon={<ShieldCheck size={16} />} onClick={() => router.push("/vani/signin?reset=1")}>Continue to sign in</Button></AuthShell>;
  if (!token || (err && !err.field)) return <AuthShell title="Link not valid" aside={false}><Alert tone="bad">{err?.message ?? "This reset link is missing its code."}</Alert><Link href="/vani/forgot" className="va-btn va-btn--primary mt-6">Request a new link</Link></AuthShell>;
  return (
    <AuthShell title="Choose a new password" aside={false}>
      <form onSubmit={submit} noValidate className="grid gap-5">
        <PasswordField label="New password" value={pw} onChange={setPw} autoComplete="new-password" showStrength describedBy="rs" error={err?.field === "password" ? err.message : null} />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={err?.field === "confirm" ? err.message : null} />
        <Button type="submit" variant="primary" size="lg" loading={busy}>Change password</Button>
      </form>
    </AuthShell>
  );
}
export const Reset = () => <Suspense fallback={null}><ResetInner /></Suspense>;

export { MailCheck, cx };
