import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { CommerceError, isUniqueViolation } from "@/lib/commerce/errors";
import { DEFAULT_PAYMENT_PROVIDER, definition, PAYMENT_PROVIDERS } from "@/lib/integrations/definitions";
import { gatewayReady } from "@/lib/payments/gateway";
import { MARKET_CODE } from "@/lib/commerce/pricing";

const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter ISO country code.");

export const marketSchema = z.object({
  code: z.string().trim().toUpperCase().regex(MARKET_CODE, "Use 2-12 letters or numbers, starting with a letter (for example NG, NGUSD or OTHER)."),
  name: z.string().trim().min(2).max(80),
  countryCode: country,
  currency: z.enum(["NGN", "GBP", "USD", "CAD", "EUR"]),
  status: z.enum(["ACTIVE", "PAUSED"]),
  paymentProvider: z.enum(PAYMENT_PROVIDERS).default(DEFAULT_PAYMENT_PROVIDER),
});

export const shippingRuleSchema = z.object({
  countryCode: country,
  providerCode: z.string().trim().min(2).max(40),
  serviceCode: z.string().trim().max(40).optional().transform((v) => v || null),
  enabled: z.boolean(),
  flatRateMinor: z.bigint().min(BigInt(0)).nullable(),
  minOrderMinor: z.bigint().min(BigInt(0)).nullable(),
  maxWeightGrams: z.number().int().min(1).max(10_000_000).nullable(),
});

export async function saveMarket(id: string | null, input: z.input<typeof marketSchema>, actorId: string) {
  const data = marketSchema.parse(input);
  if (data.code !== "OTHER" && data.code.length === 2 && data.code !== data.countryCode) {
    throw new CommerceError("MARKET_COUNTRY_MISMATCH", 422, "A two-letter market code must match its country.");
  }
  const previous = id ? await prisma.market.findUnique({ where: { id }, select: { paymentProvider: true } }) : null;
  if (data.status === "ACTIVE" && previous?.paymentProvider !== data.paymentProvider && !(await gatewayReady(data.paymentProvider))) {
    throw new CommerceError("GATEWAY_NOT_READY", 409, `${definition(data.paymentProvider).name} is not set up and switched on in Integrations. Set it up first, or save the market as paused.`);
  }
  try {
    return await prisma.$transaction(async (tx) => {
      if (id) {
        const existing = await tx.market.findUniqueOrThrow({ where: { id } });
        if (existing.currency !== data.currency && (await tx.marketProduct.count({ where: { marketId: id } })) > 0) {
          throw new CommerceError("CURRENCY_LOCKED", 409, "This market already has prices; its currency cannot change.");
        }
      }
      const market = id ? await tx.market.update({ where: { id }, data }) : await tx.market.create({ data });
      await recordAudit(tx, { action: id ? "MARKET_UPDATED" : "MARKET_CREATED", entityType: "Market", entityId: market.id, actorId, metadata: data });
      return market;
    });
  } catch (error) {
    if (isUniqueViolation(error, "code")) throw new CommerceError("DUPLICATE", 409, "Another market already uses this code.");
    throw error;
  }
}

export async function saveShippingRule(marketId: string, id: string | null, input: z.input<typeof shippingRuleSchema>, actorId: string) {
  const data = shippingRuleSchema.parse(input);
  const market = await prisma.market.findUnique({ where: { id: marketId } });
  if (!market) throw new CommerceError("MARKET_NOT_FOUND", 404, "Market not found.");
  if (market.code !== "OTHER" && data.countryCode !== market.countryCode) {
    throw new CommerceError("RULE_COUNTRY_MISMATCH", 422, `This market only delivers to ${market.countryCode}.`);
  }
  if (data.enabled && data.flatRateMinor === null) {
    throw new CommerceError("RATE_REQUIRED", 422, "Set a delivery rate before enabling this rule. Checkout never invents a price.");
  }
  return prisma.$transaction(async (tx) => {
    if (id) {
      const existing = await tx.shippingRule.findUnique({ where: { id } });
      if (!existing || existing.marketId !== marketId) throw new CommerceError("RULE_NOT_FOUND", 404, "Shipping rule not found.");
    }
    const record = { ...data, currency: market.currency };
    const rule = id ? await tx.shippingRule.update({ where: { id }, data: record }) : await tx.shippingRule.create({ data: { ...record, marketId } });
    await recordAudit(tx, { action: id ? "SHIPPING_RULE_UPDATED" : "SHIPPING_RULE_CREATED", entityType: "Market", entityId: marketId, actorId, metadata: { ruleId: rule.id, ...record } });
    return rule;
  });
}
