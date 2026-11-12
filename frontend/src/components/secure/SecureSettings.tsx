"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, RotateCw, Settings, Trash2 } from "lucide-react";
import { usePermissions } from "@/components/PermissionsProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import {
  getSecureSettings,
  purgeRetention,
  rotateKeys,
  updatePolicy,
  type SecureSettings as SecureSettingsData,
} from "@/lib/api/secure";
import {
  EmptyState,
  ErrorBanner,
  HealthPanel,
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


export function SecureSettings({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const { can } = usePermissions();
  const isAdmin = can("security:read");
  const canWrite = can("security:write");
  const [data, setData] = useState<SecureSettingsData | null>(null);
  const [error, setError] = useState("");
  const [retention, setRetention] = useState("");
  const [busy, setBusy] = useState<"" | "policy" | "rotate" | "purge">("");
  const [confirmPurge, setConfirmPurge] = useState(false);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const s = await getSecureSettings();
      setError("");
      setData(s);
      setRetention(String(s.policy.retention_days));
    } catch (err) {
      setError(errorText(err, "Couldn't load security settings."));
    }
  }, [isAdmin]);

  useEffect(() => {
    // Fetch on mount / filter change; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function savePolicy(patch: { require_vault_campaigns?: boolean; retention_days?: number }) {
    setBusy("policy");
    try {
      await updatePolicy(patch);
      onNotify("Policy updated", "The change was recorded in the audit log.");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  async function rotate() {
    setBusy("rotate");
    try {
      const r = await rotateKeys();
      onNotify(
        "Rotation complete",
        r.rotated ? `${r.rotated} records re-encrypted under ${r.active_version}.` : `All records already use ${r.active_version}.`,
      );
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  async function purge() {
    setBusy("purge");
    try {
      const r = await purgeRetention();
      onNotify("Retention purge complete", `${r.purged_contacts} inactive contacts erased, ${r.expired_staging_rows} expired upload rows removed.`);
      setConfirmPurge(false);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-6">
        <SecureHeader title="Settings" description="Encryption keys, resolution controls and data retention." />
        <EmptyState
          icon={<Settings className="size-8" strokeWidth={1.5} />}
          title="Not available for your role"
          body="Security settings are visible to the Super admin and Admins. Only the Super admin can change them."
        />
      </div>
    );
  }

  const keyring = data?.keyring;
  const staleRecords = keyring?.versions?.filter((v) => !v.active).reduce((n, v) => n + v.records, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Settings"
        description="Encryption keys, resolution controls and data retention. Keys are configured in the server environment; nothing secret is shown here."
      />
      {error ? <ErrorBanner message={error} /> : null}
      {!data ? <Loading label="Loading settings" /> : null}

      {data ? (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="flex flex-col gap-4 p-5">
              <SectionTitle
                title="Encryption keys"
                note={
                  keyring?.configured
                    ? `${keyring.algorithm} via the ${keyring.provider} key provider. Blind index: ${keyring.blind_index}.`
                    : "The vault keyring is not configured."
                }
                actions={
                  keyring?.configured && canWrite ? (
                    <Button size="sm" variant={staleRecords ? "primary" : "ghost"} onClick={() => void rotate()} disabled={busy !== ""}>
                      {busy === "rotate" ? <Spinner light={staleRecords > 0} /> : <RotateCw className="size-3.5" strokeWidth={2} />}
                      {staleRecords ? `Re-encrypt ${staleRecords} records` : "Run rotation"}
                    </Button>
                  ) : null
                }
              />
              {keyring?.configured ? (
                <TableShell minWidth={480}>
                  <thead>
                    <tr>
                      <Th>Version</Th>
                      <Th>Fingerprint</Th>
                      <Th>Records</Th>
                      <Th>Role</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {keyring.versions?.map((v) => (
                      <tr key={v.version}>
                        <Td>
                          <Mono>{v.version}</Mono>
                        </Td>
                        <Td>
                          <Mono>{v.fingerprint}</Mono>
                        </Td>
                        <Td className="tabular-nums">{v.records}</Td>
                        <Td>{v.active ? <Badge tone="live">Active, encrypts new records</Badge> : <Badge tone="neutral">Decrypt only</Badge>}</Td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              ) : (
                <ErrorBanner message={keyring?.error ?? "Set SECURE_VAULT_KEYS and SECURE_VAULT_INDEX_KEY on the API."} />
              )}
              <span className="flex items-start gap-2 text-xs text-v-muted">
                <KeyRound className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} />
                To rotate: add a new version to SECURE_VAULT_KEYS, set SECURE_VAULT_ACTIVE_KEY_VERSION to it, restart the API, then
                re-encrypt here. Remove the old version only after its record count reaches zero.
              </span>
            </Card>

            <Card className="flex flex-col gap-4 p-5">
              <SectionTitle title="Campaign policy" note={data.policy.updated_by ? `Last changed by ${data.policy.updated_by}, ${formatWhen(data.policy.updated_at)}` : undefined} />
              <span className="flex items-center justify-between gap-4 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">Require vault contacts for new campaigns</span>
                  <span className="text-xs text-v-muted">
                    Rejects plain CSV campaigns, so no new campaign queue holds plaintext numbers.
                    {data.policy.require_vault_campaigns_env ? " Enforced by the server environment." : ""}
                  </span>
                </span>
                <Switch
                  checked={data.policy.require_vault_campaigns}
                  disabled={!canWrite || busy !== "" || data.policy.require_vault_campaigns_env}
                  onChange={(v) => void savePolicy({ require_vault_campaigns: v })}
                  label="Require vault contacts"
                />
              </span>
            </Card>

            <Card className="flex flex-col gap-4 p-5">
              <SectionTitle title="Retention" note="Inactive contacts are erased after this period when a purge runs. Expired uploads are cleared too." />
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const days = Number(retention);
                  if (!Number.isInteger(days) || days < 1 || days > 3650) {
                    setError("Retention must be a whole number of days between 1 and 3650.");
                    return;
                  }
                  void savePolicy({ retention_days: days });
                }}
              >
                <div className="flex flex-col gap-1">
                  <Label htmlFor="retention-days">Retention (days)</Label>
                  <Input id="retention-days" type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} className="w-40" />
                </div>
                <Button type="submit" variant="ghost" size="sm" disabled={!canWrite || busy !== ""}>
                  Save
                </Button>
                {confirmPurge ? (
                  <span className="flex flex-wrap items-center gap-2 rounded-v-md border border-v-danger-line bg-v-danger-pale px-3 py-2 text-xs text-v-danger">
                    Erase inactive contacts older than {data.policy.retention_days} days? This cannot be undone.
                    <Button size="sm" variant="danger-outline" disabled={busy !== ""} onClick={() => void purge()}>
                      {busy === "purge" ? <Spinner light={false} /> : null}
                      Run purge
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmPurge(false)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="danger-outline" disabled={!canWrite} onClick={() => setConfirmPurge(true)}>
                    <Trash2 className="size-3.5" strokeWidth={2} />
                    Run retention purge…
                  </Button>
                )}
              </form>
            </Card>

            <Card className="flex flex-col gap-3 p-5">
              <SectionTitle title="Resolution controls" note="Who can turn a contact ID back into a number" />
              <div className="grid gap-2 text-[13px] sm:grid-cols-2">
                <span className="text-v-muted">In-process identity</span>
                <Mono>{data.resolution.in_process_identity}</Mono>
                <span className="text-v-muted">Rate limit</span>
                <span>{data.resolution.rate_limit_per_minute} resolutions per service per organisation per minute</span>
                <span className="text-v-muted">Suspicious-access alert</span>
                <span>{data.resolution.denial_alert_threshold} denials by one actor within 5 minutes</span>
                <span className="text-v-muted">External services</span>
                <span>
                  {data.resolution.external_services.length
                    ? data.resolution.external_services.map((s) => `${s.service_id} (${s.scopes.join(", ")})`).join("; ")
                    : "None configured"}
                </span>
                <span className="text-v-muted">User sessions</span>
                <span>Never permitted to resolve</span>
                <span className="text-v-muted">Default region</span>
                <span>{data.default_region}</span>
                <span className="text-v-muted">Mock telephony</span>
                <span>{data.mock_provider_enabled ? "Enabled (demo only)" : "Disabled"}</span>
              </div>
            </Card>
          </div>
          <div className="min-w-0">
            <HealthPanel health={data.health} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
