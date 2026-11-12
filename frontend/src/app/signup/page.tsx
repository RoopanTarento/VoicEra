"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { AuthHero } from "@/components/auth/AuthHero";
import { OrgInviteShare } from "@/components/auth/OrgInviteShare";
import { PasswordInput } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { joinOrganisation, lookupInvitation, type InvitationLookup } from "@/lib/api/members";
import { checkEmail } from "@/lib/api/users";
import { signup } from "@/lib/api-client";
import { ApiError } from "@/lib/api/http";
import { saveSession } from "@/lib/auth-storage";
import { markWalkthroughPending } from "@/components/walkthrough";

const authInputClass =
  "w-full box-border rounded-v-sm border border-v-line-strong bg-white px-3.5 py-3.5 text-[15.5px] text-v-fg focus:border-v-accent";

type SignupStep = 1 | 2 | 3;

const primaryButtonClass =
  "mt-0.5 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-v-sm bg-v-fg px-4.5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-v-accent disabled:cursor-not-allowed disabled:opacity-50";

const PASSWORD_RULES = [
  { id: "length", label: "8+ characters", test: (pw: string) => pw.length >= 8 },
  { id: "upper", label: "One uppercase", test: (pw: string) => /[A-Z]/.test(pw) },
  { id: "number", label: "One number", test: (pw: string) => /\d/.test(pw) },
  { id: "symbol", label: "One symbol", test: (pw: string) => /[^A-Za-z0-9]/.test(pw) },
] as const;

function passwordRulesMet(pw: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(pw));
}

function validatePassword(pw: string, confirm: string): string[] {
  const issues: string[] = [];
  if (confirm && pw !== confirm) issues.push("Passwords don't match");
  return issues;
}

function isExistingAccountPasswordError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("password") && m.includes("existing")) ||
    m.includes("invalid password")
  );
}

function finishAuth(
  data: {
    status: string;
    message?: string;
    access_token?: string;
    org_id?: string;
    role?: string;
    name?: string | null;
    is_first_login?: boolean;
  },
  email: string,
  orgName?: string,
) {
  if (data.status === "fail" || !data.access_token || !data.org_id || !data.role) {
    return data.message ?? "Something went wrong. Try again.";
  }
  saveSession({
    accessToken: data.access_token,
    email: email.trim().toLowerCase(),
    name: data.name?.trim() || undefined,
    orgId: data.org_id,
    orgName,
    role: data.role,
  });
  if (data.is_first_login) markWalkthroughPending();
  return null;
}

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen w-full items-center justify-center">
          <Spinner />
        </main>
      }
    >
      <SignUpPageInner />
    </Suspense>
  );
}

function SignUpPageInner() {
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");
  // Old shared links (/signup?org=<id>) no longer let anyone in.
  const legacyOrgLink = searchParams.has("org");

  return (
    <main className="grid min-h-screen w-full grid-cols-1 lg:grid-cols-[1.04fr_1fr]">
      <AuthHero />

      <div className="flex flex-col justify-center px-6 py-10 sm:px-12 sm:py-12">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
          {inviteToken ? (
            <InviteJoin key={inviteToken} token={inviteToken} />
          ) : legacyOrgLink ? (
            <InvitationNeeded />
          ) : (
            <CreateOrganisationSignup />
          )}
        </div>
      </div>
    </main>
  );
}

function SignInLink() {
  return (
    <p className="text-center text-xs text-v-muted">
      Already have an account?{" "}
      <Link href="/" className="font-medium text-v-accent hover:text-v-accent-deep">
        Sign in
      </Link>
    </p>
  );
}

function InvitationNeeded() {
  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-3xl font-semibold tracking-tight">Invitation needed</h2>
        <p className="m-0 text-sm font-light leading-relaxed text-v-muted">
          Joining needs an invitation link from your organisation&apos;s Super admin or an Admin.
        </p>
        <p className="m-0 text-[12.5px] font-light leading-relaxed text-v-muted">
          Ask them to invite your email from Members; the link they send works once, for you only.
        </p>
      </div>
      <Link href="/signup" className={primaryButtonClass}>
        Create a new organisation instead
      </Link>
      <SignInLink />
    </>
  );
}

/** /signup?invite=<token>: join the inviting organisation with the role the
 * invitation carries. The email is fixed by the invitation. */
function InviteJoin({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<InvitationLookup | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [existingAccount, setExistingAccount] = useState(false);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    lookupInvitation(token)
      .then(async (data) => {
        // Someone who already has a VoicEra account signs in with that password
        // instead of creating a new one.
        const exists = await checkEmail(data.email)
          .then((r) => r.exists)
          .catch(() => false);
        if (cancelled) return;
        setExistingAccount(exists);
        setInvite(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLookupError(err instanceof Error ? err.message : "This invitation link isn't valid.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const passwordRuleStatus = useMemo(
    () => PASSWORD_RULES.map((rule) => ({ ...rule, met: rule.test(password) })),
    [password],
  );
  const canSubmit = existingAccount
    ? password.length > 0
    : fullName.trim().length > 0 && passwordRulesMet(password) && password === confirmPassword;

  async function handleJoin() {
    if (!invite || !canSubmit || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      // New accounts get the profile name; an existing account keeps its own.
      const data = await joinOrganisation(
        invite.email,
        password,
        token,
        existingAccount ? undefined : fullName.trim(),
      );
      const err = finishAuth(data, invite.email, invite.org_name);
      if (err) {
        setError(err);
        setSubmitting(false);
        return;
      }
      router.push("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't complete your join. Try again.";
      setError(
        isExistingAccountPasswordError(message)
          ? "That password doesn't match your existing VoicEra account. Sign in instead if you forgot it."
          : message,
      );
      setSubmitting(false);
    }
  }

  if (lookupError) {
    return (
      <>
        <div className="flex flex-col gap-2">
          <h2 className="m-0 text-3xl font-semibold tracking-tight">Invitation not valid</h2>
          <p className="m-0 text-sm font-light leading-relaxed text-v-danger">{lookupError}</p>
          <p className="m-0 text-[12.5px] font-light leading-relaxed text-v-muted">
            Invitation links expire after 7 days and work once. Ask your organisation&apos;s Super admin or an Admin for a new
            one.
          </p>
        </div>
        <SignInLink />
      </>
    );
  }

  if (!invite) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-v-muted">
        <Spinner light={false} /> Checking your invitation…
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-v-muted">
          You&apos;re invited
        </span>
        <h2 className="m-0 text-3xl font-semibold tracking-tight">
          Join {invite.org_name} as {invite.role_label}
        </h2>
        {invite.expires_at ? (
          <p className="m-0 text-sm font-light leading-relaxed text-v-muted">
            This invitation expires {new Date(invite.expires_at).toLocaleString()}.
          </p>
        ) : null}
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleJoin();
        }}
      >
        <div className="flex flex-col gap-2.5">
          <label htmlFor="inv-email" className="text-[13px] font-medium">
            Email
          </label>
          <input
            id="inv-email"
            type="email"
            value={invite.email}
            readOnly
            aria-readonly="true"
            className={`${authInputClass} bg-v-soft/50 text-v-muted-2`}
          />
          <p className="m-0 text-[12px] font-light text-v-muted">The invitation is for this email only.</p>
        </div>

        {!existingAccount ? (
          <div className="flex flex-col gap-2.5">
            <label htmlFor="inv-name" className="text-[13px] font-medium">
              Full name
            </label>
            <input
              id="inv-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Doe"
              className={authInputClass}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5">
          <label htmlFor="inv-password" className="text-[13px] font-medium">
            {existingAccount ? "Your VoicEra password" : "Password"}
          </label>
          <PasswordInput
            id="inv-password"
            autoComplete={existingAccount ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={existingAccount ? "Enter your password" : "Create a password"}
            className={authInputClass}
          />
          {existingAccount ? (
            <p className="m-0 text-[12px] font-light leading-relaxed text-v-muted">
              You already have a VoicEra account with this email. Use its password to add {invite.org_name}.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-live="polite">
              {passwordRuleStatus.map((rule) => (
                <li
                  key={rule.id}
                  className={`flex items-center gap-1 text-[12px] font-medium transition-colors ${
                    rule.met ? "text-v-accent" : "text-v-muted"
                  }`}
                >
                  {rule.met ? (
                    <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <span
                      className="inline-block size-3.5 shrink-0 rounded-full border border-v-line-strong"
                      aria-hidden
                    />
                  )}
                  {rule.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!existingAccount ? (
          <div className="flex flex-col gap-2.5">
            <label htmlFor="inv-confirm" className="text-[13px] font-medium">
              Confirm password
            </label>
            <PasswordInput
              id="inv-confirm"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Type it again"
              className={authInputClass}
            />
            {confirmPassword && password !== confirmPassword ? (
              <span className="text-[12.5px] text-v-danger">Passwords don&apos;t match</span>
            ) : null}
          </div>
        ) : null}

        {error ? <span className="text-[12.5px] text-v-danger">{error}</span> : null}

        <button type="submit" disabled={!canSubmit || submitting} className={primaryButtonClass}>
          {submitting ? <Spinner /> : null}
          {submitting ? "Joining…" : `Join ${invite.org_name}`}
        </button>
      </form>

      <SignInLink />
    </>
  );
}

/** The original two-step "create a new organisation" signup. */
function CreateOrganisationSignup() {
  const router = useRouter();
  const [step, setStep] = useState<SignupStep>(1);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordIssues, setPasswordIssues] = useState<string[]>([]);

  const [organisationName, setOrganisationName] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [existingAccount, setExistingAccount] = useState(false);
  const [createdOrg, setCreatedOrg] = useState<{ orgName: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setPasswordIssues(validatePassword(password, confirmPassword));
  }, [password, confirmPassword]);

  const validEmail = /\S+@\S+\.\S+/.test(email);
  const passwordValid = passwordRulesMet(password);
  const step1Valid =
    fullName.trim().length > 0 &&
    validEmail &&
    passwordValid &&
    password === confirmPassword &&
    confirmPassword.length > 0 &&
    passwordIssues.length === 0;

  const passwordRuleStatus = useMemo(
    () => PASSWORD_RULES.map((rule) => ({ ...rule, met: rule.test(password) })),
    [password],
  );

  const canCreate = organisationName.trim().length > 0;

  async function goToStep2() {
    if (!step1Valid) return;
    setError("");
    setCheckingEmail(true);
    try {
      const result = await checkEmail(email.trim());
      setExistingAccount(result.exists);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify that email. Try again.");
    } finally {
      setCheckingEmail(false);
    }
  }

  function handleExistingAccountPasswordError() {
    setStep(1);
    setError("That password doesn't match your existing account. Re-enter it above, or sign in if you forgot it.");
  }

  async function handleCreateOrg() {
    if (!canCreate || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const data = await signup(email.trim(), password, organisationName.trim(), fullName.trim());
      const err = finishAuth(data, email.trim(), organisationName.trim());
      if (err) {
        setError(err);
        setSubmitting(false);
        return;
      }
      setCreatedOrg({ orgName: organisationName.trim() });
      setStep(3);
      setSubmitting(false);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Couldn't reach the server. Try again.";
      if (isExistingAccountPasswordError(message)) {
        handleExistingAccountPasswordError();
      } else {
        setError(message);
      }
      setSubmitting(false);
    }
  }

  return (
    <>
      {step === 3 && createdOrg ? (
        <OrgInviteShare
          orgName={createdOrg.orgName}
          onContinue={() => router.push("/dashboard")}
        />
      ) : step === 1 ? (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="m-0 text-3xl font-semibold tracking-tight">Create your account</h2>
            <p className="m-0 text-sm font-light leading-relaxed text-v-muted">
              Start in seconds — no card required.
            </p>
          </div>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              goToStep2();
            }}
          >
            <div className="flex flex-col gap-2.5">
              <label htmlFor="su-name" className="text-[13px] font-medium">
                Full name
              </label>
              <input
                id="su-name"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jane Doe"
                className={authInputClass}
              />
            </div>

            <div className="flex flex-col gap-2.5">
              <label htmlFor="su-email" className="text-[13px] font-medium">
                Email
              </label>
              <input
                id="su-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@organisation.org"
                className={authInputClass}
              />
            </div>

            <div className="flex flex-col gap-2.5">
              <label htmlFor="su-password" className="text-[13px] font-medium">
                Password
              </label>
              <PasswordInput
                id="su-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                className={authInputClass}
              />
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-live="polite">
                {passwordRuleStatus.map((rule) => (
                  <li
                    key={rule.id}
                    className={`flex items-center gap-1 text-[12px] font-medium transition-colors ${
                      rule.met ? "text-v-accent" : "text-v-muted"
                    }`}
                  >
                    {rule.met ? (
                      <Check className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden />
                    ) : (
                      <span
                        className="inline-block size-3.5 shrink-0 rounded-full border border-v-line-strong"
                        aria-hidden
                      />
                    )}
                    {rule.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-col gap-2.5">
              <label htmlFor="confirm-password" className="text-[13px] font-medium">
                Confirm password
              </label>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Type it again"
                className={authInputClass}
              />
              {passwordIssues.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {passwordIssues.map((issue) => (
                    <li key={issue} className="text-[12.5px] text-v-danger">
                      {issue}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {error ? <span className="text-[12.5px] text-v-danger">{error}</span> : null}

            <button
              type="submit"
              disabled={!step1Valid || checkingEmail}
              className="mt-0.5 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-v-sm bg-v-fg px-4.5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-v-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkingEmail ? <Spinner /> : null}
              {checkingEmail ? "Checking…" : "Continue"}
            </button>
          </form>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="m-0 text-3xl font-semibold tracking-tight">Your organisation</h2>
            <p className="m-0 text-sm font-light leading-relaxed text-v-muted">
              Agents and call logs live inside an organisation. To join an existing one, open the invitation
              link your organisation&apos;s Super admin or an Admin sent you.
            </p>
          </div>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateOrg();
            }}
          >
            {existingAccount ? (
              <p className="m-0 rounded-v-sm border border-v-line bg-v-soft/50 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-v-muted">
                You already have a Voicera account with this email. The password you entered
                in step 1 must match that account to create another organisation.{" "}
                <Link href="/" className="font-medium text-v-accent hover:text-v-accent-deep">
                  Sign in
                </Link>{" "}
                if you forgot it.
              </p>
            ) : null}
            <div className="flex flex-col gap-2.5">
              <label htmlFor="org-name" className="text-[13px] font-medium">
                Organisation name
              </label>
              <input
                id="org-name"
                type="text"
                autoComplete="organization"
                value={organisationName}
                onChange={(e) => setOrganisationName(e.target.value)}
                placeholder="COSS India"
                className={authInputClass}
              />
            </div>

            {error ? <span className="text-[12.5px] text-v-danger">{error}</span> : null}

            <button
              type="submit"
              disabled={!canCreate || submitting}
              className="mt-0.5 flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-v-sm bg-v-fg px-4.5 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-v-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Spinner /> : null}
              {submitting ? "Creating organisation" : "Create organisation"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setStep(1);
              setError("");
            }}
            className="cursor-pointer text-center text-xs font-medium text-v-muted hover:text-v-accent"
          >
            ← Back to account details
          </button>
        </>
      )}

      {step !== 3 ? <SignInLink /> : null}
    </>
  );
}
