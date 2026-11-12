"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Download, Eye, Pencil, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Button, IconButton } from "@/components/ui/Button";
import { Badge, Tag } from "@/components/ui/Badge";
import { Dialog, DialogHeader } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { usePermissions } from "@/components/PermissionsProvider";
import { useContactLists } from "@/hooks/useContactLists";
import {
  getContactList,
  getUploadRules,
  type ContactList,
  type ContactListDetail,
  type ContactListUploadResult,
  type UploadRules,
} from "@/lib/api/contact-lists";
import { HelpPopover } from "@/components/ui/HelpPopover";
import { NameField, nameReady } from "@/components/ui/NameField";
import { NAME_MAX, tidyName } from "@/lib/naming";
import { formatDateTime } from "@/lib/format";

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx"];
const MAX_ROW_NUMBERS_SHOWN = 15;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "4, 9, 12 and 3 more" — the server may list fewer numbers than it counted. */
function rowNumbers(numbers: number[], total: number): string {
  const shown = numbers.slice(0, MAX_ROW_NUMBERS_SHOWN).join(", ");
  const rest = total - Math.min(numbers.length, MAX_ROW_NUMBERS_SHOWN);
  return rest > 0 ? `${shown} and ${rest.toLocaleString()} more` : shown;
}

// --- Upload guidelines -----------------------------------------------------------

// Shown until the API's rules load (the API enforces the same limits).
const FALLBACK_RULES: UploadRules = {
  formats: [".csv", ".xlsx"],
  max_bytes: 10 * 1024 * 1024,
  max_rows: 50_000,
  phone_columns: ["phone_number", "phone", "mobile"],
  name_columns: ["name"],
  name_min: 3,
  name_max: 80,
  name_characters: "letters, numbers, spaces and - – _ . , & ( ) / : ' # +",
};
let cachedRules: UploadRules | null = null;

function useUploadRules(): UploadRules {
  const [rules, setRules] = useState<UploadRules>(cachedRules ?? FALLBACK_RULES);
  useEffect(() => {
    if (cachedRules) return;
    let cancelled = false;
    getUploadRules()
      .then((r) => {
        cachedRules = r;
        if (!cancelled) setRules(r);
      })
      .catch(() => {
        /* the fallback says the same */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return rules;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** File upload best practices, next to every place a list is uploaded. */
function UploadGuidelines({ align = "left" }: { align?: "left" | "right" }) {
  const rules = useUploadRules();
  return (
    <HelpPopover label="Upload guidelines" title="Before you upload" align={align}>
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-4 text-v-body">
        <li>
          <strong className="font-semibold">Format:</strong> {rules.formats.join(" or ")} (first sheet only). Save CSVs as
          UTF-8.
        </li>
        <li>
          <strong className="font-semibold">Size:</strong> up to {megabytes(rules.max_bytes)} and{" "}
          {rules.max_rows.toLocaleString()} rows per list. Split bigger files into several lists.
        </li>
        <li>
          <strong className="font-semibold">Columns:</strong> headers in the first row; one column called{" "}
          <code className="font-mono text-[11px]">{rules.phone_columns[0]}</code> (or phone / mobile), an optional{" "}
          <code className="font-mono text-[11px]">name</code>. Other columns become variables the agent can use.
        </li>
        <li>
          <strong className="font-semibold">Numbers:</strong> one per row, with the country code, e.g. +919876543210.
          In Excel, format the column as Text so the + and leading digits stay.
        </li>
        <li>Repeated and invalid numbers are skipped and reported by row number.</li>
        <li>
          <strong className="font-semibold">File name:</strong> short and descriptive, e.g. ward-12-wave-1.csv. It&apos;s
          saved in that standard form.
        </li>
        <li>Don&apos;t include Aadhaar, bank or other ID numbers. Phone numbers are protected on upload; the file isn&apos;t kept.</li>
      </ul>
    </HelpPopover>
  );
}

// --- Upload dialog -------------------------------------------------------------

function UploadListDialog({
  takenNames,
  uploading,
  onUpload,
  onClose,
}: {
  /** Existing list names: a new one must differ (ignoring case). */
  takenNames: string[];
  uploading: boolean;
  onUpload: (name: string, file: File) => Promise<ContactListUploadResult | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ContactListUploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rules = useUploadRules();

  function pickFile(next: File) {
    const lower = next.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setFileError("Upload a CSV (.csv) or Excel (.xlsx) file.");
      setFile(null);
      return;
    }
    if (next.size > rules.max_bytes) {
      setFileError(
        `This file is ${(next.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${megabytes(rules.max_bytes)}; split it into smaller lists.`,
      );
      setFile(null);
      return;
    }
    if (next.size === 0) {
      setFileError("This file is empty.");
      setFile(null);
      return;
    }
    setFileError("");
    setFile(next);
    // Suggest a standard list name from the file name; never overwrite one already typed.
    if (!name.trim()) {
      const suggested = tidyName(
        next.name
          .replace(/\.(csv|xlsx)$/i, "")
          .replace(/[_]+/g, " ")
          .replace(/[^\p{L}\p{M}\p{Nd} \-–_.,&()/:'#+]+/gu, " "),
      ).slice(0, NAME_MAX);
      setName(suggested);
    }
  }

  async function confirmUpload() {
    if (!file || !nameReady(name, takenNames, "contact list")) return;
    const res = await onUpload(tidyName(name), file);
    if (res) setResult(res);
  }

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-lg">
      <DialogHeader
        title={result ? "List uploaded" : "Upload contact list"}
        subtitle={result ? result.name : "A CSV or Excel file with a phone_number column."}
        onClose={onClose}
      />
      <div className="flex flex-col gap-4 p-5">
        {result ? (
          <>
            <p className="flex items-start gap-2 text-sm text-v-fg">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-v-ok" strokeWidth={1.75} />
              <span>
                <strong className="font-semibold">{plural(result.contacts, "contact")}</strong> saved (
                {result.new_contacts.toLocaleString()} new).
              </span>
            </p>
            {result.invalid_rows > 0 ? (
              <p className="rounded-v-md border border-v-warn-tint bg-v-warn-tint px-3.5 py-2.5 text-xs text-v-warn-ink">
                Skipped {plural(result.invalid_rows, "invalid row")}
                {result.invalid_row_numbers.length ? `: ${rowNumbers(result.invalid_row_numbers, result.invalid_rows)}` : ""}.
              </p>
            ) : null}
            {result.repeated_rows > 0 ? (
              <p className="rounded-v-md border border-v-line bg-v-soft px-3.5 py-2.5 text-xs text-v-body">
                Skipped {plural(result.repeated_rows, "repeated row")} (same number earlier in the file)
                {result.repeated_row_numbers.length
                  ? `: ${rowNumbers(result.repeated_row_numbers, result.repeated_rows)}`
                  : ""}
                .
              </p>
            ) : null}
            <div className="flex justify-end border-t border-v-line pt-4">
              <Button size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <NameField
              label="List name"
              value={name}
              onChange={setName}
              taken={takenNames}
              what="contact list"
              placeholder="Belagavi farmers – Kharif 2026"
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) pickFile(dropped);
              }}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-v-md border border-dashed p-8 text-center transition-colors ${
                dragOver ? "border-v-accent bg-v-pale" : "border-v-line bg-v-soft hover:border-v-accent"
              }`}
            >
              <Upload className="size-5 text-v-muted" strokeWidth={1.75} />
              <span className="text-sm font-semibold">{file ? file.name : "Drop a CSV or Excel file here"}</span>
              <span className="text-xs text-v-muted">
                {file
                  ? `${(file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 0 })} KB · click to pick another`
                  : `.csv or .xlsx · up to ${megabytes(rules.max_bytes)} and ${rules.max_rows.toLocaleString()} rows · needs a "phone_number" column`}
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (picked) pickFile(picked);
                  e.target.value = "";
                }}
              />
            </div>
            {fileError ? <p className="text-sm text-v-danger">{fileError}</p> : null}

            <p className="flex items-start gap-2 rounded-v-md border border-v-line bg-v-surface-sunk px-3 py-2 text-xs text-v-body">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-v-accent" strokeWidth={2} />
              Numbers are hashed and encrypted on upload, and the file itself isn&apos;t stored.
            </p>
            <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs text-v-muted">
              <UploadGuidelines />
              <span>
              Need a template?{" "}
              <a
                href="/samples/campaign_sample_20.csv"
                download="campaign_sample_20.csv"
                className="inline-flex items-center gap-1 font-medium text-v-accent hover:underline"
              >
                <Download className="size-3" strokeWidth={1.75} />
                Download sample CSV
              </a>
              </span>
            </p>

            <div className="flex justify-end gap-2 border-t border-v-line pt-4">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!file || !nameReady(name, takenNames, "contact list") || uploading}
                onClick={confirmUpload}
              >
                {uploading ? <Spinner /> : <Upload className="size-3.5" strokeWidth={1.75} />}
                Upload list
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// --- Rename dialog -------------------------------------------------------------

function RenameListDialog({
  list,
  takenNames,
  busy,
  onRename,
  onClose,
}: {
  list: ContactList;
  /** Other lists' names (not this one's). */
  takenNames: string[];
  busy: boolean;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(list.name);
  const trimmed = tidyName(name);

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-sm">
      <DialogHeader title="Rename list" onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <NameField label="List name" value={name} onChange={setName} taken={takenNames} what="contact list" autoFocus />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!nameReady(name, takenNames, "contact list") || trimmed === list.name || busy}
            onClick={() => onRename(trimmed)}
          >
            {busy ? <Spinner /> : null}
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Delete confirmation dialog --------------------------------------------------

function DeleteListDialog({
  list,
  busy,
  onConfirm,
  onClose,
}: {
  list: ContactList;
  busy: boolean;
  /** Resolves to the server's reason when the list can't be deleted. */
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");

  async function confirm() {
    setError("");
    const reason = await onConfirm();
    if (reason) setError(reason);
    else onClose();
  }

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-sm">
      <DialogHeader title="Delete list?" onClose={onClose} />
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm font-light leading-relaxed text-v-fg">
          Delete <strong className="font-semibold">{list.name}</strong>? New campaigns can&apos;t use it any more. This
          can&apos;t be undone.
        </p>
        {error ? (
          <p className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-3.5 py-2.5 text-sm text-v-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger-outline" size="sm" disabled={busy} onClick={confirm}>
            {busy ? <Spinner light={false} /> : null}
            Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// --- Masked preview dialog ---------------------------------------------------------

function ListPreviewDialog({
  list,
  canWrite,
  onClose,
}: {
  list: ContactList;
  canWrite: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ContactListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getContactList(list.list_id)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load this list.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [list.list_id]);

  // Variable columns in first-seen order across the previewed contacts.
  const variableKeys = useMemo(() => {
    const keys: string[] = [];
    for (const c of detail?.contacts ?? []) {
      for (const k of Object.keys(c.variables ?? {})) if (!keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [detail]);

  const contacts = detail?.contacts ?? [];

  return (
    <Dialog open onClose={onClose} widthClassName="max-w-3xl">
      <DialogHeader
        title={list.name}
        subtitle={`${plural(list.size, "contact")} · numbers are masked`}
        onClose={onClose}
      />
      <div className="flex flex-col gap-4 p-5">
        {!canWrite ? (
          <p className="flex items-start gap-2 rounded-v-md border border-v-line bg-v-surface-sunk px-3 py-2 text-xs text-v-body">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-v-accent" strokeWidth={2} />
            Only your organisation&apos;s Super admin uploads and changes contact lists.
          </p>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-v-muted">
            <Spinner light={false} /> Loading contacts…
          </div>
        ) : error ? (
          <p className="text-sm text-v-danger">{error}</p>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-v-muted">This list has no contacts.</p>
        ) : (
          <>
            <span className="text-xs text-v-muted">
              Showing the first {contacts.length.toLocaleString()} of {list.size.toLocaleString()}.
            </span>
            <div className="overflow-x-auto rounded-v-md border border-v-line">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-v-line text-left font-mono text-[10px] uppercase tracking-[.1em] text-v-muted">
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    {variableKeys.map((k) => (
                      <th key={k} className="whitespace-nowrap px-4 py-3 font-medium">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.contact_id} className="border-b border-v-line last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{c.masked_phone ?? "–"}</td>
                      <td className="px-4 py-3">{c.display_name || <span className="text-v-muted">–</span>}</td>
                      {variableKeys.map((k) => (
                        <td key={k} className="whitespace-nowrap px-4 py-3">
                          {c.variables?.[k] || <span className="text-v-muted">–</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

// --- Main page -----------------------------------------------------------------------

export function ContactLists({ onNotify }: { onNotify: (title: string, note: string) => void }) {
  const { can } = usePermissions();
  const canWrite = can("contacts:write");
  const { lists, loading, loadError, uploading, busyId, upload, rename, remove } = useContactLists(onNotify);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<ContactList | null>(null);
  const [renameTarget, setRenameTarget] = useState<ContactList | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactList | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-v-line pb-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">Contact lists</h1>
          <p className="max-w-[64ch] text-sm font-light leading-relaxed text-v-muted">
            The people a campaign calls. Numbers are protected on upload and only ever shown masked.
            {canWrite ? "" : " Only your organisation's Super admin uploads lists."}
          </p>
        </div>
        {canWrite ? (
          <span className="flex items-center gap-4">
            <UploadGuidelines align="right" />
            <Button variant="primary" onClick={() => setUploadOpen(true)}>
              <Upload className="size-4" strokeWidth={1.75} />
              Upload list
            </Button>
          </span>
        ) : null}
      </div>

      {loadError ? (
        <div className="rounded-v-md border border-v-danger-line bg-v-danger-pale px-4 py-3 text-sm text-v-danger">
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-v-muted">
          <Spinner light={false} /> Loading contact lists…
        </div>
      ) : lists.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-v-md border border-dashed border-v-line bg-white p-12 text-center">
          <span className="flex flex-col gap-1">
            <span className="text-sm font-semibold">No lists yet</span>
            <span className="text-xs font-light text-v-muted">
              {canWrite
                ? "Upload a CSV or Excel file of contacts to create your first list."
                : "Your Super admin uploads them."}
            </span>
          </span>
          {canWrite ? (
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="size-3.5" strokeWidth={1.75} />
              Upload your first list
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-v-md border border-v-line bg-white">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-v-line text-left font-mono text-[10px] uppercase tracking-[.1em] text-v-muted">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 text-right font-medium">Contacts</th>
                <th className="px-4 py-3 font-medium">Columns</th>
                <th className="px-4 py-3 font-medium">Uploaded by</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Campaigns</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((l) => {
                const campaigns = l.campaigns ?? 0;
                const active = l.active_campaigns ?? 0;
                return (
                  <tr key={l.list_id} className="border-b border-v-line last:border-b-0">
                    <td className="max-w-[240px] px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setPreviewTarget(l)}
                        className="block max-w-full cursor-pointer truncate text-left font-medium hover:text-v-accent"
                      >
                        {l.name}
                      </button>
                      {l.filename ? (
                        <span className="block truncate text-xs font-light text-v-muted">{l.filename}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{l.size.toLocaleString()}</td>
                    <td className="max-w-[240px] px-4 py-3">
                      {l.columns.length ? (
                        <span className="flex flex-wrap gap-1">
                          {l.columns.map((col) => (
                            <Tag key={col}>{col}</Tag>
                          ))}
                        </span>
                      ) : (
                        <span className="text-v-muted">–</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-v-muted">{l.created_by ?? "–"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-v-muted">{formatDateTime(l.created_at)}</td>
                    <td className="px-4 py-3">
                      {campaigns === 0 ? (
                        <span className="text-v-muted">None</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="tabular-nums">{campaigns.toLocaleString()}</span>
                          {active > 0 ? <Badge tone="live">{active} active</Badge> : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center justify-end gap-1.5">
                        <Tooltip text="View contacts">
                          <IconButton
                            aria-label="View contacts"
                            onClick={() => setPreviewTarget(l)}
                            className="bg-v-soft hover:border-v-accent hover:bg-v-pale hover:text-v-accent"
                          >
                            <Eye className="size-4" strokeWidth={1.75} />
                          </IconButton>
                        </Tooltip>
                        {canWrite ? (
                          <>
                            <Tooltip text="Rename list">
                              <IconButton
                                aria-label="Rename list"
                                disabled={busyId === l.list_id}
                                onClick={() => setRenameTarget(l)}
                                className="bg-v-soft hover:border-v-accent hover:bg-v-pale hover:text-v-accent"
                              >
                                <Pencil className="size-4" strokeWidth={1.75} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip text="Delete list">
                              <IconButton
                                aria-label="Delete list"
                                disabled={busyId === l.list_id}
                                onClick={() => setDeleteTarget(l)}
                                className="bg-v-soft hover:border-v-danger-line hover:bg-v-danger-pale hover:text-v-danger"
                              >
                                <Trash2 className="size-4" strokeWidth={1.75} />
                              </IconButton>
                            </Tooltip>
                          </>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {uploadOpen && canWrite ? (
        <UploadListDialog
          takenNames={lists.map((l) => l.name)}
          uploading={uploading}
          onUpload={upload}
          onClose={() => setUploadOpen(false)}
        />
      ) : null}

      {previewTarget ? (
        <ListPreviewDialog
          key={previewTarget.list_id}
          list={previewTarget}
          canWrite={canWrite}
          onClose={() => setPreviewTarget(null)}
        />
      ) : null}

      {renameTarget && canWrite ? (
        <RenameListDialog
          key={renameTarget.list_id}
          list={renameTarget}
          takenNames={lists.filter((l) => l.list_id !== renameTarget.list_id).map((l) => l.name)}
          busy={busyId === renameTarget.list_id}
          onRename={async (name) => {
            const ok = await rename(renameTarget.list_id, name);
            if (ok) setRenameTarget(null);
          }}
          onClose={() => setRenameTarget(null)}
        />
      ) : null}

      {deleteTarget && canWrite ? (
        <DeleteListDialog
          key={deleteTarget.list_id}
          list={deleteTarget}
          busy={busyId === deleteTarget.list_id}
          onConfirm={() => remove(deleteTarget.list_id)}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}
