import type { Role } from "./types";

export type Permission =
  | "view" | "create" | "edit" | "resolve" | "submit" | "approve" | "return"
  | "agent" | "export" | "audit" | "users" | "archive" | "simulate";

export const ROLES: { id: Role; label: string; summary: string }[] = [
  { id: "admin", label: "Admin", summary: "Everything, including people and prototype settings." },
  { id: "product_manager", label: "Product manager", summary: "Creates and edits packages, resolves items and submits quotes." },
  { id: "operations", label: "Operations", summary: "Edits hosting and configuration, exports quotes and sets up agents." },
  { id: "reviewer", label: "Reviewer", summary: "Reads everything, approves or returns submitted quotes." },
  { id: "viewer", label: "Viewer", summary: "Reads packages and quotes. Cannot change anything." },
];

const MATRIX: Record<Role, Permission[]> = {
  admin: ["view", "create", "edit", "resolve", "submit", "approve", "return", "agent", "export", "audit", "users", "archive", "simulate"],
  product_manager: ["view", "create", "edit", "resolve", "submit", "export", "audit", "archive"],
  operations: ["view", "edit", "resolve", "export", "agent", "audit"],
  reviewer: ["view", "approve", "return", "export", "audit"],
  viewer: ["view"],
};

export const can = (role: Role | undefined | null, p: Permission): boolean => !!role && MATRIX[role].includes(p);
export const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)?.label ?? r;

const NEEDS: Record<Permission, string> = {
  view: "view packages", create: "create packages", edit: "edit packages", resolve: "resolve policy items", submit: "submit quotes for approval",
  approve: "approve quotes", return: "return quotes", agent: "set up agents", export: "export quotes", audit: "see the audit log",
  users: "manage people", archive: "archive packages", simulate: "change prototype settings",
};
export const WHO: Record<Permission, Role[]> = Object.fromEntries(
  (Object.keys(NEEDS) as Permission[]).map((p) => [p, (Object.keys(MATRIX) as Role[]).filter((r) => MATRIX[r].includes(p))]),
) as Record<Permission, Role[]>;

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** A plain explanation to show when something is disabled. */
export function denial(role: Role | undefined | null, p: Permission): string {
  const who = WHO[p].filter((r) => r !== "admin").map((r) => roleLabel(r).toLowerCase());
  const ask = list([...who, "an admin"]);
  return `${role ? `The ${roleLabel(role).toLowerCase()} role` : "Your role"} can't ${NEEDS[p]}. Ask ${ask}.`;
}
