/**
 * Creates a staff account from the command line. This is how the first Owner
 * is created; there is no default password and no public sign-up.
 *
 *   npm run admin:create -- --email you@example.com --name "Your Name" [--role OWNER] [--env-file .env.local]
 *
 * The database comes from DATABASE_URL in the env file (default .env.local),
 * NOT from the terminal: editors can silently inject .env into terminals, which
 * once sent an account to the local database instead of production. The target
 * is shown and must be confirmed. The password is typed at a hidden prompt (or
 * piped on stdin), never passed as an argument, so it stays out of shell history.
 */
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

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

function databaseUrlFrom(file: string) {
  if (!existsSync(file)) throw new Error(`${file} not found. Pass --env-file <path> to the file holding the target DATABASE_URL.`);
  const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  const value = line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`DATABASE_URL is not set in ${file}.`);
  return value;
}

async function confirm(question: string) {
  if (!process.stdin.isTTY) return process.env.ADMIN_CREATE_CONFIRM === "yes";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function main() {
  const email = arg("email");
  const name = arg("name");
  const role = (arg("role") ?? "OWNER").toUpperCase();
  const envFile = arg("env-file") ?? ".env.local";
  if (!email || !name) throw new Error('Usage: npm run admin:create -- --email you@example.com --name "Your Name" [--role OWNER] [--env-file .env.local]');

  process.env.DATABASE_URL = databaseUrlFrom(envFile);
  const { hostname, port, pathname } = new URL(process.env.DATABASE_URL);
  // Show the target without printing the full Neon endpoint id.
  const host = /^[\d.]+$|^localhost$/.test(hostname) ? `${hostname}:${port}` : hostname.replace(/^([a-z]+-[a-z]+)[^.]*/, "$1…");
  console.log(`About to create a ${role} account for ${email}`);
  console.log(`  database: ${pathname.slice(1)}  host: ${host}  (from ${envFile})`);
  if (!(await confirm("Type yes to continue: "))) throw new Error("Cancelled. Nothing was created.");

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
