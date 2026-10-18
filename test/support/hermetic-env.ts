import { INTEGRATIONS } from "@/lib/integrations/definitions";

// Tests must never pick up real provider credentials from the developer's shell.
for (const def of INTEGRATIONS) for (const field of def.fields) if (field.env) delete process.env[field.env];
for (const name of ["INTEGRATIONS_ENCRYPTION_KEY", "PAYSTACK_API_BASE_URL", "WHOP_API_BASE_URL", "RESEND_API_BASE_URL"]) delete process.env[name];
