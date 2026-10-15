/**
 * Creates a staff account from the command line. This is how the first Owner
 * is created; there is no default password and no public sign-up.
 *
 *   npm run admin:create -- --email you@example.com --name "Your Name" [--role OWNER]
 *
 * The password is typed at a hidden prompt (or piped on stdin), never passed as
 * an argument, so it stays out of shell history.
 */
import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline";

loadEnvConfig(process.cwd());

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function hiddenPrompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) { rl.close(); return line; }
    return "";
  }
  process.stdout.write(question);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => {
    let value = "";
    const onData = (buffer: Buffer) => {
      for (const ch of buffer.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off("data", onData);
          process.stdout.write("\n"); resolve(value); return;
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f") value = value.slice(0, -1); else value += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  const email = arg("email");
  const name = arg("name");
  const role = (arg("role") ?? "OWNER").toUpperCase();
  if (!email || !name) throw new Error('Usage: npm run admin:create -- --email you@example.com --name "Your Name" [--role OWNER]');
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (.env.local or .env).");

  // Show which database this will write to, without printing the full Neon endpoint id.
  const { hostname, port } = new URL(process.env.DATABASE_URL);
  const host = /^[\d.]+$|^localhost$/.test(hostname) ? `${hostname}:${port}` : hostname.replace(/^([a-z]+-[a-z]+)[^.]*/, "$1…");
  console.log(`Creating ${role} account for ${email} in database at ${host}`);

  const password = await hiddenPrompt("Password (12+ characters): ");
  if (process.stdin.isTTY && (await hiddenPrompt("Repeat password: ")) !== password) throw new Error("Passwords do not match.");

  const { createStaff } = await import("../src/lib/admin/staff");
  const { prisma } = await import("../src/lib/prisma");
  const user = await createStaff({ email, name, role: role as "OWNER", password }, { id: "cli", role: "OWNER" });
  console.log(`Created ${user.role} ${user.email}. Sign in at /admin/login.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
