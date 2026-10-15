import { testDatabaseUrl } from "./test-database";

// Runs in every integration worker before any app module is imported.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.CHECKOUT_ENABLED = "true";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.CRON_SECRET = "test-cron-secret-0123456789abcdef0123456789";
process.env.PAYMENT_WINDOW_MINUTES = "30";
delete process.env.PAYSTACK_ALLOW_LIVE_KEYS;
