"use server";

import { adminAction, type ActionState } from "@/lib/admin/action";
import { checkbox, oneOf, text } from "@/lib/admin/form";
import { definition, INTEGRATIONS, type IntegrationKey } from "@/lib/integrations/definitions";
import { saveIntegration } from "@/lib/integrations/store";
import { testIntegration } from "@/lib/integrations/testing";

const KEYS = INTEGRATIONS.map((d) => d.key) as IntegrationKey[];

export async function saveIntegrationAction(_: ActionState, form: FormData) {
  return adminAction("settings.manage", async (staff) => {
    const key = oneOf(form, "integration", KEYS);
    const def = definition(key);
    const settings: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const field of def.fields) {
      // Inputs for fields set by environment variables are disabled and not submitted.
      if (!form.has(`present:${field.key}`)) continue;
      if (field.secret) secrets[field.key] = text(form, field.key, 4000);
      else if (field.type === "boolean") settings[field.key] = checkbox(form, field.key) ? "true" : "false";
      else if (field.type === "select") settings[field.key] = oneOf(form, field.key, (field.options ?? []).map((o) => o.value));
      else settings[field.key] = text(form, field.key, 500);
    }
    const clear = form.getAll("clear").map(String).filter((k) => def.fields.some((f) => f.secret && f.key === k));
    await saveIntegration(key, { enabled: checkbox(form, "enabled"), settings, secrets, clear }, staff.id);
    return `${def.name} saved.`;
  }, { storefront: true });
}

export async function testIntegrationAction(_: ActionState, form: FormData) {
  return adminAction("settings.manage", async (staff) => {
    const key = oneOf(form, "integration", KEYS);
    const result = await testIntegration(key, staff);
    return { ok: result.ok, message: result.ok ? `Test passed. ${result.message}` : `Test failed. ${result.message}` };
  });
}
