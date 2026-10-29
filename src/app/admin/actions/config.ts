"use server";

import { adminAction, type ActionState } from "@/lib/admin/action";
import { checkbox, id, int, oneOf, optionalInt, optionalMoney, text } from "@/lib/admin/form";
import { ADJUSTMENT_REASONS, changeStock, saveLocation } from "@/lib/admin/stock";
import { saveMarket, saveShippingRule } from "@/lib/admin/markets";
import { SETTINGS, SETTING_KEYS, updateSettings, type SettingKey } from "@/lib/settings";
import { changeOwnPassword, createStaff, resetStaffPassword, updateStaff } from "@/lib/admin/staff";
import { clearSessionCookie } from "@/lib/admin/session";

const ROLES = ["OWNER", "ADMIN", "FINANCE", "FULFILMENT", "CATALOGUE", "EDITOR", "VIEWER"] as const;

/* ---------------------------------------------------------------- inventory */

export async function changeStockAction(_: ActionState, form: FormData) {
  return adminAction("inventory.manage", async (staff) => {
    const mode = oneOf(form, "mode", ["delta", "count"] as const);
    const quantity = int(form, "quantity");
    const reason = oneOf(form, "reason", ADJUSTMENT_REASONS);
    const base = { variantId: id(form, "variantId"), locationId: id(form, "locationId"), note: text(form, "note", 500) };
    const result = mode === "count"
      ? await changeStock({ ...base, mode, quantity, reason: "STOCKTAKE" }, staff.id)
      : await changeStock({ ...base, mode, quantity, reason: reason === "STOCKTAKE" ? "CORRECTION" : reason }, staff.id);
    return result.delta === 0 ? "No change: the count matches." : `Stock ${result.delta > 0 ? "+" : ""}${result.delta}. On hand now ${result.onHand} (${result.reserved} reserved).`;
  }, { storefront: true });
}

export async function saveLocationAction(_: ActionState, form: FormData) {
  return adminAction("inventory.manage", async (staff) => {
    const locationId = text(form, "locationId", 64) || null;
    await saveLocation(locationId, { code: text(form, "code", 40), name: text(form, "name", 100), address: text(form, "address", 500), active: checkbox(form, "active") }, staff.id);
    return locationId ? "Location saved." : "Location created.";
  });
}

/* ------------------------------------------------------------------ markets */

export async function saveMarketAction(_: ActionState, form: FormData) {
  return adminAction("markets.manage", async (staff) => {
    const marketId = text(form, "marketId", 64) || null;
    const manyCountries = text(form, "covers", 10) === "many";
    await saveMarket(marketId, {
      code: manyCountries ? "OTHER" : text(form, "code", 40), name: text(form, "name", 80), countryCode: text(form, "countryCode", 2),
      currency: oneOf(form, "currency", ["NGN", "GBP", "USD", "CAD", "EUR"] as const), status: oneOf(form, "status", ["ACTIVE", "PAUSED"] as const),
    }, staff.id);
    return marketId ? "Saved." : "Added. Now add a delivery fee, and give your products a price here.";
  }, { storefront: true });
}

export async function saveShippingRuleAction(_: ActionState, form: FormData) {
  return adminAction("markets.manage", async (staff) => {
    const ruleId = text(form, "ruleId", 64) || null;
    await saveShippingRule(id(form, "marketId"), ruleId, {
      countryCode: text(form, "countryCode", 2), providerCode: text(form, "providerCode", 40), serviceCode: text(form, "serviceCode", 40),
      enabled: checkbox(form, "enabled"), flatRateMinor: optionalMoney(form, "flatRate"), minOrderMinor: optionalMoney(form, "minOrder"),
      maxWeightGrams: optionalInt(form, "maxWeightGrams"),
    }, staff.id);
    return ruleId ? "Delivery fee saved." : "Delivery fee added.";
  });
}

/* ----------------------------------------------------------------- settings */

export async function saveSettingsAction(_: ActionState, form: FormData) {
  return adminAction("settings.manage", async (staff) => {
    const changes: Partial<Record<SettingKey, unknown>> = {};
    for (const key of SETTING_KEYS) {
      if (!form.has(`present:${key}`)) continue;
      const sample = SETTINGS[key].default;
      changes[key] = typeof sample === "boolean" ? checkbox(form, key) : typeof sample === "number" ? int(form, key) : text(form, key, 500);
    }
    await updateSettings(changes, staff.id);
    return "Settings saved.";
  }, { storefront: true });
}

/* -------------------------------------------------------------------- staff */

export async function createStaffAction(_: ActionState, form: FormData) {
  return adminAction("staff.manage", async (staff) => {
    const created = await createStaff({ email: text(form, "email", 254), name: text(form, "name", 80), role: oneOf(form, "role", ROLES), password: String(form.get("password") ?? "") }, staff);
    return `Account created for ${created.email}. Share the password with them securely; they should change it after signing in.`;
  });
}

export async function updateStaffAction(_: ActionState, form: FormData) {
  return adminAction("staff.manage", async (staff) => {
    await updateStaff(id(form, "staffId"), { name: text(form, "name", 80), role: oneOf(form, "role", ROLES), active: checkbox(form, "active") }, staff);
    return "Staff member saved.";
  });
}

export async function resetPasswordAction(_: ActionState, form: FormData) {
  return adminAction("staff.manage", async (staff) => {
    await resetStaffPassword(id(form, "staffId"), String(form.get("password") ?? ""), staff);
    return "Password reset; their existing sessions were signed out.";
  });
}

export async function changeOwnPasswordAction(_: ActionState, form: FormData) {
  return adminAction("view", async (staff) => {
    await changeOwnPassword(staff, String(form.get("current") ?? ""), String(form.get("next") ?? ""));
    await clearSessionCookie();
    return { message: "Password changed. Sign in with your new password.", redirectTo: "/admin/login" };
  });
}
