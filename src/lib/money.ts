/**
 * Money is stored as integer minor units (kobo, pence, cents). All supported
 * currencies (NGN, GBP, USD, CAD) use two decimal places.
 */

export function parseMoney(input: string): bigint {
  const cleaned = input.trim().replace(/[,\s]/g, "").replace(/^[₦£$]/, "");
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new RangeError("Enter an amount like 1850 or 1850.50.");
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
}

export function formatMoney(minor: bigint | number | string, currency: string) {
  const value = Number(BigInt(minor)) / 100;
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Minor units as a plain decimal string for form inputs ("185050" -> "1850.50"). */
export function minorToInput(minor: bigint | null | undefined) {
  if (minor === null || minor === undefined) return "";
  const abs = minor < BigInt(0) ? -minor : minor;
  return `${minor < BigInt(0) ? "-" : ""}${abs / BigInt(100)}.${(abs % BigInt(100)).toString().padStart(2, "0")}`;
}
