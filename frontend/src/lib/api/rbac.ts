import { apiFetch } from "@/lib/api/http";

export interface RbacMe {
  email: string;
  org_id: string | null;
  role: string | null;
  role_label: string | null;
  permissions: string[];
  platform_admin: boolean;
  adopter_status: string | null;
}

export interface RoleInfo {
  id: string;
  label: string;
  description: string;
  assignable: boolean;
  permissions: string[];
}

export function getMyAccess(): Promise<RbacMe> {
  return apiFetch<RbacMe>("/rbac/me");
}

export interface PermissionMatrixGroup {
  area: string;
  rows: { label: string; permission: string }[];
}

export interface RoleCatalogue {
  roles: RoleInfo[];
  permissions: Record<string, string>;
  /** How the role table is shown: areas of the product, one row per action. */
  matrix: PermissionMatrixGroup[];
}

export function getRoleCatalogue(): Promise<RoleCatalogue> {
  return apiFetch("/rbac/roles");
}

export function changeMemberRole(
  email: string,
  role: string,
): Promise<{ status: string; message: string; role: string; previous_role: string }> {
  return apiFetch("/members/role", { method: "PATCH", body: JSON.stringify({ email, role }) });
}
