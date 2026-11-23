"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AudioLines } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { markWalkthroughPending } from "@/components/walkthrough";
import { saveSession } from "@/lib/auth-storage";
import {
  clearTryDraft,
  readTryDraft,
  requestLoginCode,
  saveTriedAgent,
  verifyLoginCode,
} from "@/lib/api/try-agent";

/** Sign in (or create an account) with an emailed code; the tried agent is
 * then saved to the workspace and opened there. */
export function CodeSignIn({ agentLabel }: { agentLabel: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code" | "saving">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function sendCode() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await requestLoginCode(email.trim());
      setNote(r.message);
      setStage("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (code.trim().length < 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await verifyLoginCode(email.trim(), code.trim());
      saveSession({
        accessToken: data.access_token,
        email: email.trim().toLowerCase(),
        orgId: data.org_id,
        role: data.role,
      });
      if (data.is_first_login) markWalkthroughPending();
      setStage("saving");
      const draft = readTryDraft();
      if (!draft) {
        router.push("/dashboard");
        return;
      }
      try {
        const saved = await saveTriedAgent(draft);
        clearTryDraft();
        router.push(`/agents/${saved.agent_id}`);
      } catch {
        // The workspace can't build it on its own providers yet: finish in the
        // quick setup, which keeps the schemes and language from the draft.
        router.push("/agent-creation?quick=1&from=try");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign you in.");
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center px-4 py-14 sm:px-6 animate-v-rise">
      <div className="flex flex-col gap-6 rounded-[24px] border border-v-line bg-white px-6 py-8 sm:px-9 sm:py-10">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 text-[32px] font-semibold tracking-tight">Sign in</h1>
          <p className="m-0 text-[15.5px] font-light text-v-muted-2">to launch campaigns with your agent.</p>
        </div>

        <div className="flex items-center gap-3 rounded-v-xl bg-v-pale px-4 py-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-v-fg text-white">
            <AudioLines className="size-[18px]" strokeWidth={1.9} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-semibold">{agentLabel}</span>
            <span className="text-[13.5px] text-v-muted-2">Will be saved to your workspace</span>
          </span>
        </div>

        {stage === "saving" ? (
          <p className="m-0 flex items-center gap-2 text-[14.5px] text-v-muted-2">
            <Spinner light={false} /> Saving your agent to your workspace…
          </p>
        ) : stage === "email" ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <label className="flex flex-col gap-2 text-[14px] font-semibold">
              Work email
              <Input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@department.gov.in"
              />
            </label>
            <Button type="submit" disabled={busy || !email.trim()} className="w-full !py-3.5 !text-[15px]">
              {busy ? <Spinner /> : null}
              Send me a sign-in code
            </Button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <p className="m-0 text-[14px] text-v-muted-2">{note}</p>
            <label className="flex flex-col gap-2 text-[14px] font-semibold">
              Sign-in code
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="6-digit code"
                className="tracking-[.3em]"
              />
            </label>
            <Button type="submit" disabled={busy || code.length < 6} className="w-full !py-3.5 !text-[15px]">
              {busy ? <Spinner /> : null}
              Sign in
            </Button>
            <button
              type="button"
              onClick={() => {
                setStage("email");
                setCode("");
                setError("");
              }}
              className="text-[13.5px] font-medium text-v-muted-2 hover:text-v-fg"
            >
              Use a different email
            </button>
          </form>
        )}

        {error ? (
          <p role="alert" className="m-0 rounded-v-md border border-v-danger-line bg-v-danger-pale px-3.5 py-2.5 text-[13.5px] text-v-danger">
            {error}
          </p>
        ) : null}

        <p className="m-0 text-center text-[14px] text-v-muted-2">No account? One is created when you sign in.</p>
      </div>
    </section>
  );
}
