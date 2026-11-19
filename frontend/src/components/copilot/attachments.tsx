"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { FileSpreadsheet, FileText, Presentation, X } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { fetchCopilotAttachment, uploadCopilotAttachment } from "@/lib/api/copilot";
import type { CopilotAttachmentRef } from "@/lib/api-types";

/** What the Agent Builder chat takes: images, contact CSVs and documents.
 * The API checks the same list; this is only so the picker and drag-and-drop
 * turn away the rest before uploading. */
export const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,.csv,text/csv,.pdf,.docx,.pptx,.xlsx,.txt,.md,.json";
const DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".md", ".json"];
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

function isDocumentName(name: string): boolean {
  const lower = name.toLowerCase();
  return DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isSupportedAttachment(file: File): boolean {
  return IMAGE_TYPES.includes(file.type) || file.name.toLowerCase().endsWith(".csv") || isDocumentName(file.name);
}

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "done" | "error";
  ref?: CopilotAttachmentRef;
  errorMessage?: string;
}

/** Files picked for the next message: each uploads as soon as it's added, so
 * sending only waits on files still in flight. */
export function useCopilotAttachments() {
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [error, setError] = useState("");
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // Object URLs outlive the component unless revoked.
  useEffect(() => () => pendingRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  function upload(item: PendingAttachment) {
    uploadCopilotAttachment(item.file)
      .then((ref) => {
        setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "done", ref } : p)));
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Upload failed.";
        setPending((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: "error", errorMessage: message } : p)),
        );
        setError(`${item.file.name}: ${message}`);
      });
  }

  function addFiles(files: FileList | File[]) {
    setError("");
    const all = Array.from(files);
    const list = all.filter(isSupportedAttachment);
    if (list.length === 0) {
      if (all.length > 0) setError("Attach an image, CSV, PDF, Word, PowerPoint, Excel or text file.");
      return;
    }
    if (pending.length + list.length > MAX_ATTACHMENTS) {
      setError(`You can attach up to ${MAX_ATTACHMENTS} files at once.`);
      return;
    }
    const oversized = list.find((f) => f.size > (isDocumentName(f.name) ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES));
    if (oversized) {
      setError(`${oversized.name} is over the ${isDocumentName(oversized.name) ? 20 : 8} MB limit.`);
      return;
    }
    const additions: PendingAttachment[] = list.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "uploading",
    }));
    setPending((prev) => [...prev, ...additions]);
    additions.forEach(upload);
  }

  function remove(id: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setError("");
  }

  /** The uploaded files' refs for sending; clears the tray. */
  function takeReady(): CopilotAttachmentRef[] {
    const refs = pending.filter((p) => p.status === "done" && p.ref).map((p) => p.ref!);
    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPending([]);
    setError("");
    return refs;
  }

  return {
    pending,
    error,
    addFiles,
    remove,
    takeReady,
    ready: pending.filter((p) => p.status === "done" && p.ref),
    uploading: pending.some((p) => p.status === "uploading"),
  };
}

/** Files on the clipboard (a pasted screenshot, a file copied in Finder).
 * Text copied from Word or a web page also carries a picture of itself; that
 * paste is text, so anything with HTML on it attaches nothing. */
export function filesFromClipboard(data: DataTransfer): File[] {
  if (Array.from(data.types).includes("text/html")) return [];
  return Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((f): f is File => f !== null);
}

/** Drag-and-drop anywhere on `onFiles`'s element, with a flag for the overlay. */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return {
    dragging,
    handlers: {
      onDragEnter: (e: DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (e: DragEvent) => {
        if (enabled && hasFiles(e)) e.preventDefault();
      },
      onDragLeave: (e: DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (e: DragEvent) => {
        if (!enabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}

export function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-v-md border-2 border-dashed border-v-accent bg-v-pale/80">
      <div className="flex flex-col items-center gap-1 text-center">
        <span className="text-[14px] font-semibold text-v-accent-deep">Drop files to attach</span>
        <span className="text-[12px] text-v-muted">Images, PDF, Word, PowerPoint, Excel, CSV or text</span>
      </div>
    </div>
  );
}

function FileIcon({ name, contentType }: { name: string; contentType?: string }) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".xlsx") || contentType === "text/csv") {
    return <FileSpreadsheet className="size-4 shrink-0 text-v-muted" strokeWidth={1.6} />;
  }
  if (lower.endsWith(".pptx")) return <Presentation className="size-4 shrink-0 text-v-muted" strokeWidth={1.6} />;
  return <FileText className="size-4 shrink-0 text-v-muted" strokeWidth={1.6} />;
}

function fileKind(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const kinds: Record<string, string> = {
    pdf: "PDF",
    docx: "Word",
    pptx: "PowerPoint",
    xlsx: "Excel",
    csv: "CSV",
    txt: "Text",
    md: "Markdown",
    json: "JSON",
  };
  return kinds[ext] ?? "File";
}

/** A file as a compact card: icon, name and type, like a chat app shows it. */
function FileCard({ name, contentType, failed }: { name: string; contentType?: string; failed?: boolean }) {
  return (
    <div
      className={`flex h-14 w-44 items-center gap-2 rounded-v-sm border px-2.5 ${
        failed ? "border-v-danger-line opacity-60" : "border-v-line bg-v-soft"
      }`}
      title={name}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-v-sm bg-v-panel">
        <FileIcon name={name} contentType={contentType} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] font-medium text-v-fg">{name}</span>
        <span className="text-[10.5px] text-v-faint">{failed ? "Couldn't attach" : fileKind(name)}</span>
      </span>
    </div>
  );
}

/** The tray of files waiting to go with the next message. */
export function PendingAttachmentStrip({
  pending,
  onRemove,
  className = "",
}: {
  pending: PendingAttachment[];
  onRemove: (id: string) => void;
  className?: string;
}) {
  if (pending.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {pending.map((p) => (
        <div key={p.id} className="relative">
          {p.file.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not a remote image next/image can optimize
            <img
              src={p.previewUrl}
              alt={p.file.name}
              className={`size-14 rounded-v-sm border object-cover ${
                p.status === "error" ? "border-v-danger-line opacity-50" : "border-v-line"
              }`}
            />
          ) : (
            <FileCard name={p.file.name} failed={p.status === "error"} />
          )}
          {p.status === "uploading" ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-v-sm bg-black/30">
              <Spinner />
            </div>
          ) : null}
          <button
            type="button"
            title="Remove"
            aria-label={`Remove ${p.file.name}`}
            onClick={() => onRemove(p.id)}
            className="absolute -right-1.5 -top-1.5 flex size-4.5 cursor-pointer items-center justify-center rounded-full bg-v-fg text-white"
          >
            <X className="size-2.5" strokeWidth={2.5} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Fetches one attachment's bytes with the same Bearer auth as everything
 * else in this app (a plain <img src> can't carry that header), then shows
 * it as a local blob URL. Caches the blob URL for the component's lifetime
 * and revokes it on unmount to avoid leaking memory across many images.
 * A CSV or document isn't an image to preview — it shows as a file card. */
export function CopilotAttachmentImage({ attachment }: { attachment: CopilotAttachmentRef }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isImage = attachment.content_type.startsWith("image/");

  useEffect(() => {
    if (!isImage) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchCopilotAttachment(attachment.attachment_id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.attachment_id, isImage]);

  if (!isImage) {
    return <FileCard name={attachment.original_filename} contentType={attachment.content_type} />;
  }
  if (failed) {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-v-sm border border-v-line bg-v-soft text-[10px] text-v-faint">
        Unavailable
      </div>
    );
  }
  if (!src) {
    return (
      <div className="flex h-20 w-20 items-center justify-center rounded-v-sm border border-v-line bg-v-soft">
        <Spinner light={false} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL, not a remote image next/image can optimize
    <img
      src={src}
      alt={attachment.original_filename}
      className="h-20 w-20 rounded-v-sm border border-v-line object-cover"
    />
  );
}
