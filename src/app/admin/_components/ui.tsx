import { AdminLink as Link } from "@/app/admin/_components/admin-link";
import type { ReactNode } from "react";
import { CheckCircle, Circle, Clock, Warning, XCircle } from "@phosphor-icons/react/dist/ssr";
import { formatMoney } from "@/lib/money";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, children, actions, className = "" }: { title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

type Tone = "good" | "warning" | "critical" | "info" | "neutral";

const TONES: Record<Tone, { className: string; Icon: typeof Circle }> = {
  good: { className: "bg-brand-50 text-brand-800 ring-brand-200", Icon: CheckCircle },
  warning: { className: "bg-amber-50 text-amber-900 ring-amber-200", Icon: Warning },
  critical: { className: "bg-red-50 text-red-800 ring-red-200", Icon: XCircle },
  info: { className: "bg-sky-50 text-sky-800 ring-sky-200", Icon: Clock },
  neutral: { className: "bg-slate-100 text-slate-700 ring-slate-200", Icon: Circle },
};

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "good", CONFIRMED: "good", SUCCEEDED: "good", DELIVERED: "good", PROCESSED: "good", REFUNDED: "neutral", COMMITTED: "good", FULFILLED: "good", APPROVED: "good", CLEARED: "good", READY: "good", SENT: "info",
  PENDING_PAYMENT: "info", PENDING: "info", INITIATED: "info", PROCESSING: "info", READY_TO_DISPATCH: "info", DISPATCHED: "info", IN_TRANSIT: "info", CREATING: "info", REFUND_PENDING: "warning", PENDING_REVIEW: "warning", DOCUMENTS_PENDING: "warning", RECEIVED: "info", SENDING: "info", NOT_SENT: "warning", RUNNING: "info",
  PAYMENT_REVIEW: "critical", FAILED: "critical", UNKNOWN: "critical", REJECTED: "critical", CUSTOMS_HOLD: "warning", PARTIALLY_REFUNDED: "warning",
  CANCELLED: "neutral", EXPIRED: "neutral", RELEASED: "neutral", ARCHIVED: "neutral", DRAFT: "neutral", PAUSED: "neutral", IGNORED: "neutral", QUOTE_PENDING: "neutral", RETURNED: "neutral",
};

export function humanise(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** Status is never colour alone: every badge carries an icon and a text label. */
export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  const { className, Icon } = TONES[tone ?? STATUS_TONE[status] ?? "neutral"];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}>
      <Icon size={12} aria-hidden="true" />
      {humanise(status)}
    </span>
  );
}

export function Money({ minor, currency }: { minor: bigint | number | string | null | undefined; currency: string }) {
  if (minor === null || minor === undefined) return <span className="text-slate-400">-</span>;
  return <span className="tabular-nums">{formatMoney(minor, currency)}</span>;
}

export function DateTime({ value }: { value: Date | null | undefined }) {
  if (!value) return <span className="text-slate-400">-</span>;
  return <time dateTime={value.toISOString()} className="tabular-nums">{value.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}</time>;
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap px-5 py-2">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length ? children : <tr><td colSpan={head.length} className="px-5 py-8 text-center text-slate-500">{empty ?? "Nothing here yet."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export const td = "px-5 py-2.5 align-top";

export function Notice({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  const { className, Icon } = TONES[tone];
  return (
    <div className={`flex gap-2 rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${className}`} role={tone === "critical" ? "alert" : "status"}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <nav className="mb-4 flex gap-1 border-b border-slate-200" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${t.key === active ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ page, hasNext, href }: { page: number; hasNext: boolean; href: (page: number) => string }) {
  if (page === 1 && !hasNext) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? <Link className="text-brand-800 hover:underline" href={href(page - 1)}>← Previous</Link> : <span />}
      <span className="text-slate-500">Page {page}</span>
      {hasNext ? <Link className="text-brand-800 hover:underline" href={href(page + 1)}>Next →</Link> : <span />}
    </div>
  );
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const inputClass = "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-slate-50";

export function Field({ label, help, children, className = "" }: { label: string; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-slate-500">{help}</span>}
    </label>
  );
}

export function Select({ name, options, defaultValue, required }: { name: string; options: (string | [string, string])[]; defaultValue?: string; required?: boolean }) {
  return (
    <select name={name} defaultValue={defaultValue} required={required} className={inputClass}>
      {options.map((o) => {
        const [value, label] = Array.isArray(o) ? o : [o, humanise(o)];
        return <option key={value} value={value}>{label}</option>;
      })}
    </select>
  );
}

export function pageParam(value: string | string[] | undefined) {
  const n = Number.parseInt(typeof value === "string" ? value : "1", 10);
  return Number.isFinite(n) && n > 0 && n < 10_000 ? n : 1;
}

export function stringParam(value: string | string[] | undefined, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
