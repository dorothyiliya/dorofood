/**
 * Local Paystack sandbox for clicking through checkout in a browser.
 *   FAKE_PAYSTACK_SECRET=sk_test_local... npx tsx scripts/fake-paystack-server.ts
 * Then run the app with PAYSTACK_SECRET_KEY set to the same value and
 * PAYSTACK_API_BASE_URL=http://127.0.0.1:4010.
 */
import { FakePaystack } from "../test/support/fake-paystack";

const secret = process.env.FAKE_PAYSTACK_SECRET ?? "";
if (!secret.startsWith("sk_test_")) throw new Error("Set FAKE_PAYSTACK_SECRET to an sk_test_ value.");
const app = process.env.APP_URL ?? "http://localhost:3000";
const port = Number(process.env.PORT ?? 4010);

new FakePaystack({ secret, interactive: { webhookUrl: `${app}/api/v1/webhooks/paystack` } }).start(port).then((p) => {
  console.log(`Fake Paystack listening on ${p.baseUrl} (webhooks to ${app})`);
});
