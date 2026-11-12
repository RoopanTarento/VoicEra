import { apiFetch } from "@/lib/api/http";

/** A named list of protected contacts. Only the Super admin uploads, renames or deletes lists. */
export interface ContactList {
  list_id: string;
  name: string;
  /** Standard stored file name ("ward-12-wave-1.csv"). */
  filename?: string | null;
  /** The file's name as uploaded. */
  original_filename?: string | null;
  size: number;
  columns: string[];
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  origin: string;
  campaigns?: number;
  active_campaigns?: number;
}

export interface ContactListUploadResult extends ContactList {
  rows: number;
  contacts: number;
  new_contacts: number;
  invalid_rows: number;
  repeated_rows: number;
  invalid_row_numbers: number[];
  repeated_row_numbers: number[];
}

export interface ContactListDetail extends ContactList {
  /** First contacts of the list, numbers masked. */
  contacts: {
    contact_id: string;
    masked_phone?: string | null;
    display_name?: string | null;
    status?: string | null;
    variables: Record<string, string>;
  }[];
}

export function listContactLists(): Promise<ContactList[]> {
  return apiFetch<ContactList[]>("/contact-lists");
}

export function getContactList(listId: string): Promise<ContactListDetail> {
  return apiFetch<ContactListDetail>(`/contact-lists/${encodeURIComponent(listId)}`);
}

/** CSV (.csv) or Excel (.xlsx); numbers are hashed and encrypted on arrival. */
export function uploadContactList(name: string, file: File): Promise<ContactListUploadResult> {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("file", file);
  return apiFetch<ContactListUploadResult>("/contact-lists", { method: "POST", body: formData });
}

export function renameContactList(listId: string, name: string): Promise<ContactList> {
  return apiFetch<ContactList>(`/contact-lists/${encodeURIComponent(listId)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteContactList(listId: string): Promise<{ status: string; message: string }> {
  return apiFetch(`/contact-lists/${encodeURIComponent(listId)}`, { method: "DELETE" });
}

/** Accepted formats, limits and naming rules for uploads (shown as guidelines). */
export interface UploadRules {
  formats: string[];
  max_bytes: number;
  max_rows: number;
  phone_columns: string[];
  name_columns: string[];
  name_min: number;
  name_max: number;
  name_characters: string;
}

export function getUploadRules(): Promise<UploadRules> {
  return apiFetch<UploadRules>("/contact-lists/rules");
}
