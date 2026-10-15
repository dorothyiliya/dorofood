/**
 * Admin routes live under /admin internally. On the dedicated admin host they
 * are served at the root ("/orders"), elsewhere at "/admin/orders". Code always
 * writes the internal form; `rebase` turns it into the form for the current host.
 */
export const ADMIN_PREFIX = "/admin";

export type AdminBase = "" | typeof ADMIN_PREFIX;

export function rebase(href: string, base: AdminBase): string {
  if (base === ADMIN_PREFIX || !href.startsWith(ADMIN_PREFIX)) return href;
  const rest = href.slice(ADMIN_PREFIX.length);
  if (rest === "") return "/";
  if (rest.startsWith("?")) return `/${rest}`;
  return rest.startsWith("/") ? rest : href; // "/administrator" is not an admin path
}
