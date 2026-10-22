"use client";

import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { usePathname } from "next/navigation";
import { ArrowCounterClockwise, ClockCounterClockwise, CreditCard, Gauge, Gear, GlobeHemisphereWest, Package, PlugsConnected, Pulse, Receipt, Tag, Users, Warehouse } from "@phosphor-icons/react/dist/ssr";

type NavLink = { href: string; label: string; Icon: typeof Gauge; exact?: boolean };

/** Plain names, grouped by what people come to do. URLs stay the same. */
const GROUPS: { title: string | null; links: NavLink[] }[] = [
  { title: null, links: [{ href: "/admin", label: "Home", Icon: Gauge, exact: true }] },
  {
    title: "Selling",
    links: [
      { href: "/admin/orders", label: "Orders", Icon: Receipt },
      { href: "/admin/catalogue", label: "Products", Icon: Package },
      { href: "/admin/categories", label: "Categories", Icon: Tag },
      { href: "/admin/inventory", label: "Stock", Icon: Warehouse },
    ],
  },
  {
    title: "Money",
    links: [
      { href: "/admin/payments", label: "Payments", Icon: CreditCard },
      { href: "/admin/refunds", label: "Refunds", Icon: ArrowCounterClockwise },
    ],
  },
  {
    title: "Setup",
    links: [
      { href: "/admin/markets", label: "Delivery & countries", Icon: GlobeHemisphereWest },
      { href: "/admin/settings", label: "Shop settings", Icon: Gear },
      { href: "/admin/staff", label: "Team", Icon: Users },
      { href: "/admin/integrations", label: "Connected services", Icon: PlugsConnected },
    ],
  },
  {
    title: "Records",
    links: [
      { href: "/admin/audit", label: "Activity log", Icon: ClockCounterClockwise },
      { href: "/admin/system", label: "Health check", Icon: Pulse },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();
  const strip = (path: string) => path.replace(/^\/admin(?=\/|$)/, "") || "/";
  const current = strip(pathname);
  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto md:flex-col md:gap-4 md:overflow-visible">
      {GROUPS.map((group, i) => (
        <div key={i} className="flex gap-1 md:flex-col">
          {group.title && <div className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:block">{group.title}</div>}
          {group.links.map(({ href, label, Icon, exact }) => {
            const target = strip(href);
            const active = exact ? current === target : current === target || current.startsWith(`${target}/`);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-brand-50 text-brand-900" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>
                <Icon size={18} weight={active ? "fill" : "regular"} aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
