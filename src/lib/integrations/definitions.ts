/**
 * The integrations the store uses, and what each needs. Values for fields are
 * resolved in src/lib/integrations/store.ts: an environment variable, when set,
 * wins over anything saved in the admin.
 */

export type IntegrationKey = "paystack" | "whop" | "nvidia" | "resend" | "storage";
export type Category = "payments" | "ai" | "email" | "storage";

export type FieldDef = {
  key: string;
  label: string;
  /** Secrets are write-only in the admin and encrypted at rest. */
  secret?: boolean;
  required?: boolean;
  env?: string;
  placeholder?: string;
  help?: string;
  type?: "text" | "boolean" | "select";
  options?: { value: string; label: string }[];
  default?: string;
};

export type IntegrationDef = {
  key: IntegrationKey;
  name: string;
  category: Category;
  summary: string;
  fields: FieldDef[];
  /** Path to register in the provider's dashboard, if it sends webhooks. */
  webhookPath?: string;
  docs: string;
};

export const INTEGRATIONS: IntegrationDef[] = [
  {
    key: "paystack",
    name: "Paystack",
    category: "payments",
    summary: "Card, bank transfer and USSD payments in naira and other African currencies.",
    fields: [
      { key: "secretKey", label: "Secret key", secret: true, required: true, env: "PAYSTACK_SECRET_KEY", placeholder: "sk_test_… or sk_live_…", help: "Paystack Dashboard → Settings → API Keys & Webhooks. Also used to verify webhooks." },
      { key: "allowLive", label: "Allow live keys", type: "boolean", env: "PAYSTACK_ALLOW_LIVE_KEYS", help: "Live keys move real money. Leave off until launch sign-off." },
    ],
    webhookPath: "/api/v1/webhooks/paystack",
    docs: "https://paystack.com/docs/payments/webhooks/",
  },
  {
    key: "whop",
    name: "Whop",
    category: "payments",
    summary: "Hosted checkout for international card payments (USD, GBP, CAD, EUR).",
    fields: [
      { key: "apiKey", label: "Company API key", secret: true, required: true, env: "WHOP_API_KEY", help: "Whop Dashboard → Developer. Needs payment read, payment manage and checkout configuration permissions." },
      { key: "webhookSecret", label: "Webhook signing secret", secret: true, required: true, env: "WHOP_WEBHOOK_SECRET", placeholder: "ws_…", help: "Shown when you create the webhook in Whop. Subscribe to payment.* and refund.* events." },
      { key: "companyId", label: "Company ID", required: true, env: "WHOP_COMPANY_ID", placeholder: "biz_…" },
      { key: "environment", label: "Environment", type: "select", env: "WHOP_ENVIRONMENT", default: "sandbox", options: [{ value: "sandbox", label: "Sandbox (test payments)" }, { value: "production", label: "Production (real money)" }] },
    ],
    webhookPath: "/api/v1/webhooks/whop",
    docs: "https://docs.whop.com/developer/guides/webhooks",
  },
  {
    key: "nvidia",
    name: "NVIDIA AI",
    category: "ai",
    summary: "Drafts product descriptions with NVIDIA-hosted language models. Staff always review before saving.",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, env: "NVIDIA_API_KEY", placeholder: "nvapi-…", help: "build.nvidia.com → your profile → API keys." },
      { key: "model", label: "Model", env: "NVIDIA_MODEL", default: "meta/llama-3.3-70b-instruct", help: "Any chat model from build.nvidia.com." },
      { key: "baseUrl", label: "API endpoint", env: "NVIDIA_BASE_URL", default: "https://integrate.api.nvidia.com/v1", help: "Change only for a self-hosted NIM." },
    ],
    docs: "https://build.nvidia.com/",
  },
  {
    key: "resend",
    name: "Resend email",
    category: "email",
    summary: "Order confirmation, dispatch and refund emails to customers.",
    fields: [
      { key: "apiKey", label: "API key", secret: true, required: true, env: "RESEND_API_KEY", placeholder: "re_…" },
      { key: "from", label: "From address", required: true, env: "EMAIL_FROM", placeholder: "Dorocity Foods <orders@dorocityfoods.com>", help: "The domain must be verified in Resend." },
      { key: "replyTo", label: "Reply-to address", env: "EMAIL_REPLY_TO", placeholder: "hello@dorocityfoods.com" },
    ],
    docs: "https://resend.com/docs",
  },
  {
    key: "storage",
    name: "Photo storage",
    category: "storage",
    summary: "Upload product photos from the admin to S3-compatible storage (Cloudflare R2, Tigris, AWS S3).",
    fields: [
      { key: "endpoint", label: "S3 endpoint", required: true, env: "S3_ENDPOINT", placeholder: "https://<account>.r2.cloudflarestorage.com" },
      { key: "region", label: "Region", env: "S3_REGION", default: "auto" },
      { key: "bucket", label: "Bucket", required: true, env: "S3_BUCKET" },
      { key: "publicBaseUrl", label: "Public URL for the bucket", required: true, env: "S3_PUBLIC_BASE_URL", placeholder: "https://images.dorocityfoods.com", help: "Where uploaded files can be viewed publicly." },
      { key: "accessKeyId", label: "Access key ID", secret: true, required: true, env: "S3_ACCESS_KEY_ID" },
      { key: "secretAccessKey", label: "Secret access key", secret: true, required: true, env: "S3_SECRET_ACCESS_KEY" },
    ],
    docs: "https://developers.cloudflare.com/r2/api/s3/api/",
  },
];

export const CATEGORY_LABELS: Record<Category, string> = {
  payments: "Payment gateways",
  ai: "AI",
  email: "Email",
  storage: "Storage",
};

export function definition(key: IntegrationKey) {
  const def = INTEGRATIONS.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown integration ${key}`);
  return def;
}

export const PAYMENT_PROVIDERS = ["paystack", "whop"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];
