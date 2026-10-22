import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { CommerceError, isUniqueViolation } from "@/lib/commerce/errors";
import { DEFAULT_PAYMENT_PROVIDER, PAYMENT_PROVIDERS, type PaymentProviderId } from "@/lib/integrations/definitions";
import { countryName } from "@/lib/countries";
import { gatewayReady } from "@/lib/payments/gateway";
import { MARKET_CODE } from "@/lib/commerce/pricing";

const country = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use a two-letter ISO country code.");

export const marketSchema = z.object({
  /** Empty: made from the country (and currency if needed). */
  code: z.union([z.literal(""), z.string().trim().toUpperCase().regex(MARKET_CODE, "Use 2-12 letters or numbers, starting with a letter (for example NG, NGUSD or OTHER).")]).optional(),
  name: z.string().trim().min(2, "Enter a name customers will recognise, e.g. Ghana.").max(80),
  countryCode: country,
  currency: z.enum(["NGN", "GBP", "USD", "CAD", "EUR"]),
  status: z.enum(["ACTIVE", "PAUSED"]),
  /** Not shown to staff: new markets use a gateway that is ready, and existing ones keep theirs. */
  paymentProvider: z.enum(PAYMENT_PROVIDERS).optional(),
});

export const shippingRuleSchema = z.object({
  countryCode: country,
  providerCode: z.string().trim().max(40).optional().transform((v) => v || "Standard"),
  serviceCode: z.string().trim().max(40).optional().transform((v) => v || null),
  enabled: z.boolean(),
  flatRateMinor: z.bigint().min(BigInt(0)).nullable(),
  minOrderMinor: z.bigint().min(BigInt(0)).nullable(),
  maxWeightGrams: z.number().int().min(1).max(10_000_000).nullable(),
});

async function readyProvider(): Promise<PaymentProviderId> {
  if (await gatewayReady(DEFAULT_PAYMENT_PROVIDER)) return DEFAULT_PAYMENT_PROVIDER;
  for (const p of PAYMENT_PROVIDERS) if (await gatewayReady(p)) return p;
  return DEFAULT_PAYMENT_PROVIDER;
}

async function freeCode(countryCode: string, currency: string) {
  for (const candidate of [countryCode, `${countryCode}${currency}`]) {
    if (!(await prisma.market.findUnique({ where: { code: candidate } }))) return candidate;
  }
  for (let i = 2; ; i++) if (!(await prisma.market.findUnique({ where: { code: `${countryCode}${currency}${i}` } }))) return `${countryCode}${currency}${i}`;
}

export async function saveMarket(id: string | null, input: z.input<typeof marketSchema>, actorId: string) {
  const parsed = marketSchema.parse(input);
  const previous = id ? await prisma.market.findUnique({ where: { id }, select: { paymentProvider: true, code: true } }) : null;
  const code = parsed.code || previous?.code || (await freeCode(parsed.countryCode, parsed.currency));
  const paymentProvider = parsed.paymentProvider ?? (previous?.paymentProvider as PaymentProviderId | undefined) ?? (await readyProvider());
  const data = { ...parsed, code, paymentProvider };
  if (code !== "OTHER" && code.length === 2 && code !== data.countryCode) {
    throw new CommerceError("MARKET_COUNTRY_MISMATCH", 422, "A two-letter code must be the country's own code, e.g. GH for Ghana.");
  }
  if (data.status === "ACTIVE" && previous?.paymentProvider !== paymentProvider && !(await gatewayReady(paymentProvider))) {
    throw new CommerceError("GATEWAY_NOT_READY", 409, "Card payments aren't set up yet, so this can't be opened for orders. Save it as paused for now.");
  }
  try {
    return await prisma.$transaction(async (tx) => {
      if (id) {
        const existing = await tx.market.findUniqueOrThrow({ where: { id } });
        if (existing.currency !== data.currency && (await tx.marketProduct.count({ where: { marketId: id } })) > 0) {
          throw new CommerceError("CURRENCY_LOCKED", 409, "Products already have prices in this currency, so it can't be changed.");
        }
      }
      const market = id ? await tx.market.update({ where: { id }, data }) : await tx.market.create({ data });
      await recordAudit(tx, { action: id ? "MARKET_UPDATED" : "MARKET_CREATED", entityType: "Market", entityId: market.id, actorId, metadata: data });
      return market;
    });
  } catch (error) {
    if (isUniqueViolation(error, "code")) throw new CommerceError("DUPLICATE", 409, "You already have a place with this code. Leave the code empty to make one automatically.");
    throw error;
  }
}

export async function saveShippingRule(marketId: string, id: string | null, input: z.input<typeof shippingRuleSchema>, actorId: string) {
  const data = shippingRuleSchema.parse(input);
  const market = await prisma.market.findUnique({ where: { id: marketId } });
  if (!market) throw new CommerceError("MARKET_NOT_FOUND", 404, "Market not found.");
  if (market.code !== "OTHER" && data.countryCode !== market.countryCode) {
    throw new CommerceError("RULE_COUNTRY_MISMATCH", 422, `${market.name} only covers ${countryName(market.countryCode)}. To deliver to other countries, add them to a "Rest of the world" place.`);
  }
  if (data.enabled && data.flatRateMinor === null) {
    throw new CommerceError("RATE_REQUIRED", 422, "Enter the delivery fee before switching delivery on.");
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
