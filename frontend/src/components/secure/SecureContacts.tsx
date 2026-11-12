"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Download, FileSpreadsheet, KeyRound, Upload } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, StatCard } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { Switch } from "@/components/ui/Switch";
import { usePermissions } from "@/components/PermissionsProvider";
import {
  listBatches,
  tokenizeBatch,
  uploadContacts,
  type BatchSummary,
  type RowStatus,
  type TokenizeResult,
  type UploadReport,
} from "@/lib/api/secure";
import {
  ErrorBanner,
  SecureHeader,
  SectionTitle,
  ShortId,
  TableShell,
  Td,
  Th,
  errorText,
  formatWhen,
} from "./shared";

const ROW_STATUS: Record<RowStatus, { label: string; tone: "live" | "danger" | "warn" | "neutral" }> = {
  valid: { label: "Valid", tone: "live" },
  invalid: { label: "Invalid", tone: "danger" },
  duplicate_in_file: { label: "Duplicate in file", tone: "warn" },
  duplicate_existing: { label: "Already protected", tone: "neutral" },
};

type Filter = "all" | "issues";

export function SecureContacts({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const router = useRouter();
  const { can } = usePermissions();
  const canUpload = can("contacts:write");
  const inputRef = useRef<HTMLInputElement>(null);
  const [synthetic, setSynthetic] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [tokenizing, setTokenizing] = useState(false);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [result, setResult] = useState<TokenizeResult | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [batches, setBatches] = useState<BatchSummary[]>([]);

  const loadBatches = useCallback(async () => {
    try {
      const recent = await listBatches();
      setBatches(recent);
    } catch {
      /* the history panel is secondary; the upload flow still works */
    }
  }, []);

  useEffect(() => {
    // Fetch on mount / filter change; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBatches();
  }, [loadBatches]);

  async function handleFile(file: File) {
    setError("");
    setResult(null);
    setReport(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a .csv file. The first row must be a header with a phone_number column.");
      return;
    }
    setUploading(true);
    try {
      const r = await uploadContacts(file, synthetic);
      setReport(r);
      setFilter(r.summary.valid_rows === r.summary.total_rows ? "all" : "issues");
      void loadBatches();
    } catch (err) {
      setError(errorText(err, "The file couldn't be validated."));
    } finally {
      setUploading(false);
    }
  }

  async function tokenize() {
    if (!report) return;
    setTokenizing(true);
    setError("");
    try {
      const r = await tokenizeBatch(report.batch_id);
      setResult(r);
      onNotify("Contacts protected", `${r.created} contacts encrypted and tokenised.`);
      void loadBatches();
    } catch (err) {
      setError(errorText(err, "Tokenisation failed."));
    } finally {
      setTokenizing(false);
    }
  }

  const rows = report ? (filter === "issues" ? report.issues : report.rows) : [];

  return (
    <div className="flex flex-col gap-6">
      <SecureHeader
        title="Contacts"
        description="Upload a contact list. Numbers are validated and encrypted on arrival; after tokenisation each contact is known everywhere else in VoicEra only by an opaque contact ID."
        actions={
          <a
            href="/samples/secure_contacts_sample_100.csv"
            download
            className="inline-flex items-center gap-2 rounded-v-md border border-v-line bg-white px-3 py-2 text-xs font-semibold text-v-fg hover:border-v-accent hover:bg-v-soft"
          >
            <Download className="size-3.5" strokeWidth={2} />
            Sample CSV (100 synthetic contacts)
          </a>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {!canUpload ? (
        <ErrorBanner message="Your role can view protected contacts but not upload them. Only the Super admin uploads numbers." />
      ) : null}

      {!report && canUpload ? (
        <Card
          className={`flex flex-col items-center gap-3 border-dashed px-6 py-12 text-center transition-colors ${
            dragOver ? "border-v-accent bg-v-pale" : ""
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
        >
          <FileSpreadsheet className="size-9 text-v-dim" strokeWidth={1.4} />
          <span className="text-[15px] font-semibold">Drop a contact CSV here</span>
          <span className="max-w-[60ch] text-sm font-light text-v-muted">
            Required column: <code className="font-mono text-[12px]">phone_number</code> (also accepted: phone, mobile,
            msisdn). Optional: name, email, and up to 20 other columns. Numbers without a + are read as Indian numbers.
          </span>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? <Spinner /> : <Upload className="size-4" strokeWidth={2} />}
              {uploading ? "Validating…" : "Choose file"}
            </Button>
            <span className="flex items-center gap-2 text-sm text-v-body">
              <Switch checked={synthetic} onChange={setSynthetic} label="Synthetic demo data" />
              Synthetic demo data
            </span>
          </div>
          <span className="text-xs text-v-faint">
            Synthetic contacts can only be dialled through the mock telephony provider.
          </span>
          <input
            ref={inputRef}
            id="secure-contact-file"
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </Card>
      ) : null}

      {report ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="size-4 text-v-muted" strokeWidth={1.8} />
              <span className="font-medium">{report.filename}</span>
              <span className="text-v-muted">
                · phone column <code className="font-mono text-[12px]">{report.detected.phone}</code>
                {report.detected.name ? <> · name <code className="font-mono text-[12px]">{report.detected.name}</code></> : null}
                {report.detected.attributes.length ? ` · ${report.detected.attributes.length} other columns` : ""}
              </span>
              {report.synthetic ? <Badge tone="accent">Synthetic</Badge> : null}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setReport(null);
                setResult(null);
              }}
            >
              Upload another file
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
            <StatCard label="Rows" value={String(report.summary.total_rows)} />
            <StatCard label="Valid" value={String(report.summary.valid_rows)} note="Ready to tokenise" />
            <StatCard label="Invalid" value={String(report.summary.invalid_rows)} note="Excluded" />
            <StatCard label="Duplicates" value={String(report.summary.duplicate_in_file)} note="Repeated in this file, kept once" />
            <StatCard label="In vault" value={String(report.summary.duplicate_existing)} note="Already protected, skipped" />
          </div>

          {result ? (
            <Card className="flex flex-col gap-3 border-v-ok-tint bg-v-ok-tint/40 p-5">
              <span className="flex items-center gap-2 text-[15px] font-semibold text-v-ok-ink">
                <CheckCircle2 className="size-5" strokeWidth={2} />
                {result.created} contacts encrypted and tokenised
              </span>
              <span className="text-sm text-v-body">
                Each number is stored as AES-256-GCM ciphertext. The staged upload has been deleted.
                {result.skipped_duplicates ? ` ${result.skipped_duplicates} skipped as duplicates.` : ""}
                {result.failed ? ` ${result.failed} failed integrity checks and were not stored.` : ""}
              </span>
              <TableShell minWidth={560}>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Contact ID</Th>
                    <Th>Display number</Th>
                    <Th>Key</Th>
                  </tr>
                </thead>
                <tbody>
                  {result.contacts.slice(0, 8).map((c) => (
                    <tr key={c.contact_id}>
                      <Td>{c.display_name ?? "—"}</Td>
                      <Td>
                        <ShortId id={c.contact_id} />
                      </Td>
                      <Td className="font-mono text-[12px]">{c.masked_phone}</Td>
                      <Td className="font-mono text-[12px] text-v-muted">{c.key_version}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => router.push(`/secure/vault?batch=${encodeURIComponent(result.batch_id)}`)}>
                  Open in Contact Vault
                </Button>
                <Button variant="ghost" onClick={() => router.push("/secure/campaigns")}>
                  Create a campaign from these contacts
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <span className="flex items-center gap-2 text-sm text-v-body">
                <KeyRound className="size-4 text-v-accent" strokeWidth={1.8} />
                Valid rows are staged encrypted for 24 hours. Tokenising assigns contact IDs and moves them into the vault.
              </span>
              <Button onClick={() => void tokenize()} disabled={tokenizing || report.summary.valid_rows === 0}>
                {tokenizing ? <Spinner /> : null}
                {tokenizing ? "Tokenising…" : `Tokenise ${report.summary.valid_rows} valid contacts`}
              </Button>
            </Card>
          )}

          <SectionTitle
            title="Validation results"
            note={
              report.rows_truncated && filter === "all"
                ? `Showing the first ${report.rows.length} rows. All issues are listed under “Issues only”.`
                : "Numbers are shown masked. Raw values are never returned to the browser."
            }
            actions={
              <div className="flex rounded-v-md border border-v-line bg-v-panel p-0.5">
                {(["all", "issues"] as Filter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`cursor-pointer rounded-v-sm px-3 py-1.5 text-xs font-medium ${
                      filter === f ? "bg-v-fg text-white" : "text-v-body hover:bg-v-soft"
                    }`}
                  >
                    {f === "all" ? "All rows" : `Issues only (${report.issues.length})`}
                  </button>
                ))}
              </div>
            }
          />
          <TableShell minWidth={640}>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Name</Th>
                <Th>Number</Th>
                <Th>Result</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <Td colSpan={5} className="py-8 text-center text-v-disabled">
                    No rows to show
                  </Td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.row}>
                    <Td className="font-mono text-[12px] text-v-muted">{r.row}</Td>
                    <Td>{r.name ?? <span className="text-v-disabled">—</span>}</Td>
                    <Td className="whitespace-nowrap font-mono text-[12px]">{r.masked_phone ?? <span className="text-v-disabled">—</span>}</Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={ROW_STATUS[r.status].tone}>{ROW_STATUS[r.status].label}</Badge>
                    </Td>
                    <Td className="text-xs text-v-muted">
                      {r.reason ?? r.warning ?? ""}
                      {r.existing_contact_id ? (
                        <>
                          {" "}
                          <ShortId id={r.existing_contact_id} />
                        </>
                      ) : null}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </TableShell>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <SectionTitle title="Upload history" note="Recent uploads in this organisation" />
        {batches.length === 0 ? (
          <span className="text-sm text-v-disabled">No uploads yet.</span>
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Uploaded</Th>
                <Th>By</Th>
                <Th>Valid / rows</Th>
                <Th>Issues</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batch_id}>
                  <Td className="font-medium">
                    {b.filename} {b.synthetic ? <Badge tone="accent">Synthetic</Badge> : null}
                  </Td>
                  <Td className="text-v-muted">{formatWhen(b.created_at)}</Td>
                  <Td className="text-v-muted">{b.created_by}</Td>
                  <Td className="tabular-nums">
                    {b.summary.valid_rows} / {b.summary.total_rows}
                  </Td>
                  <Td className="tabular-nums text-v-muted">
                    {b.summary.invalid_rows + b.summary.duplicate_in_file + b.summary.duplicate_existing}
                  </Td>
                  <Td>
                    {b.status === "tokenized" ? (
                      <Badge tone="live">{b.result?.created ?? 0} tokenised</Badge>
                    ) : (
                      <Badge tone="warn">Validated, not tokenised</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </div>
  );
}
