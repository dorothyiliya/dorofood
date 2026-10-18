"use client";

import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import { usePathname } from "next/navigation";
import { ArrowCounterClockwise, ClockCounterClockwise, CreditCard, Gauge, Gear, GlobeHemisphereWest, PlugsConnected, Pulse, Receipt, SquaresFour, Tag, Users, Warehouse } from "@phosphor-icons/react/dist/ssr";

const LINKS = [
  { href: "/admin", label: "Dashboard", Icon: Gauge, exact: true },
  { href: "/admin/orders", label: "Orders", Icon: Receipt },
  { href: "/admin/payments", label: "Payments", Icon: CreditCard },
  { href: "/admin/refunds", label: "Refunds", Icon: ArrowCounterClockwise },
  { href: "/admin/catalogue", label: "Catalogue", Icon: SquaresFour },
  { href: "/admin/categories", label: "Categories", Icon: Tag },
  { href: "/admin/inventory", label: "Inventory", Icon: Warehouse },
  { href: "/admin/markets", label: "Markets & delivery", Icon: GlobeHemisphereWest },
  { href: "/admin/settings", label: "Store settings", Icon: Gear },
  { href: "/admin/integrations", label: "Integrations", Icon: PlugsConnected },
  { href: "/admin/staff", label: "Staff", Icon: Users },
  { href: "/admin/audit", label: "Audit log", Icon: ClockCounterClockwise },
  { href: "/admin/system", label: "System", Icon: Pulse },
];

export function AdminNav() {
  const pathname = usePathname();
  const strip = (path: string) => path.replace(/^\/admin(?=\/|$)/, "") || "/";
  const current = strip(pathname);
  return (
    <nav aria-label="Admin" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {LINKS.map(({ href, label, Icon, exact }) => {
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
    </nav>
  );
}
