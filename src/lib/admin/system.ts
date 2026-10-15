import "server-only";
import { prisma } from "@/lib/prisma";
import { ConfigError, getAppBaseUrl, getCronSecret, getPaystackConfig } from "@/lib/env";
import { jsonSafe } from "@/lib/audit";
import { runReconciliation } from "@/lib/commerce/jobs";
import { getConfiguredCarrier } from "@/lib/commerce/shipments";
import { getSettings } from "@/lib/settings";

export type Check = { label: string; ok: boolean; detail: string };

function probe(label: string, fn: () => string): Check {
  try {
    return { label, ok: true, detail: fn() };
  } catch (error) {
    return { label, ok: false, detail: error instanceof ConfigError ? error.message : "Unexpected error" };
  }
}

/** Configuration and dependency status. Reports presence and mode only, never secret values. */
export async function systemStatus() {
  const settings = await getSettings();
  const env: Check[] = [
    { label: "Database (DATABASE_URL)", ok: Boolean(process.env.DATABASE_URL), detail: process.env.DATABASE_URL ? "Configured" : "Missing" },
    probe("Paystack (PAYSTACK_SECRET_KEY)", () => `${getPaystackConfig().mode === "live" ? "LIVE" : "Test"} key configured`),
    { label: "Checkout allowed on this deployment (CHECKOUT_ENABLED)", ok: process.env.CHECKOUT_ENABLED === "true", detail: process.env.CHECKOUT_ENABLED === "true" ? "Yes" : "No: checkout returns 503 regardless of store settings" },
    probe("Public URL (APP_BASE_URL)", () => getAppBaseUrl()),
    probe("Scheduled jobs (CRON_SECRET)", () => (getCronSecret(), "Configured")),
    { label: "Shipping carrier integration", ok: getConfiguredCarrier() !== null, detail: getConfiguredCarrier() ? "Configured" : "None: use manual shipments with a tracking number" },
  ];

  let database: Check;
  try {
    const [row] = await prisma.$queryRaw<{ migrations: number; version: string }[]>`
      SELECT (SELECT count(*)::int FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) AS migrations, split_part(version(), ' ', 2) AS version`;
    database = { label: "Database connection", ok: true, detail: `PostgreSQL ${row.version}, ${row.migrations} migrations applied` };
  } catch {
    database = { label: "Database connection", ok: false, detail: "Cannot reach the database" };
  }

  const paystackReady = env[1].ok;
  const checkoutLive = settings["checkout.open"] && env[2].ok && paystackReady;
  return {
    env,
    database,
    deployment: process.env.VERCEL_ENV ?? (process.env.NODE_ENV === "production" ? "production (self-hosted)" : "local development"),
    checkout: {
      live: checkoutLive,
      reasons: [
        !settings["checkout.open"] && "The store setting \"Store accepts orders\" is off.",
        !env[2].ok && "CHECKOUT_ENABLED is not \"true\" on this deployment.",
        !paystackReady && "No usable Paystack secret key.",
      ].filter(Boolean) as string[],
    },
    jobs: await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
  };
}

/** Runs the reconciliation job and keeps a record of the run. */
export async function runReconciliationJob(triggeredBy: string) {
  const run = await prisma.jobRun.create({ data: { name: "reconcile", status: "RUNNING", triggeredBy } });
  try {
    const result = await runReconciliation();
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", resultJson: jsonSafe(result), finishedAt: new Date() } });
    return result;
  } catch (error) {
    await prisma.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", error: String((error as Error).message).slice(0, 2000), finishedAt: new Date() } });
    throw error;
  }
}
