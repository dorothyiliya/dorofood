import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { rebase } from "@/lib/admin/paths";

const saved = process.env.ADMIN_HOST;
afterEach(() => { process.env.ADMIN_HOST = saved; });

function hit(url: string, { cookie = false } = {}) {
  const host = new URL(url).host;
  const headers: Record<string, string> = { host };
  if (cookie) headers.cookie = "dfa_session=token";
  const res = middleware(new NextRequest(url, { headers }));
  return { status: res.status, location: res.headers.get("location"), rewrite: res.headers.get("x-middleware-rewrite") };
}

describe("rebase", () => {
  it("maps internal admin paths for the admin host and leaves everything else", () => {
    expect(rebase("/admin", "")).toBe("/");
    expect(rebase("/admin/orders/abc", "")).toBe("/orders/abc");
    expect(rebase("/admin?x=1", "")).toBe("/?x=1");
    expect(rebase("/administrator", "")).toBe("/administrator");
    expect(rebase("/shop", "")).toBe("/shop");
    expect(rebase("/admin/orders", "/admin")).toBe("/admin/orders");
  });
});

describe("admin routing with ADMIN_HOST", () => {
  it("serves the admin at clean paths on the admin host", () => {
    process.env.ADMIN_HOST = "admin.dorocityfoods.com";
    expect(new URL(hit("https://admin.dorocityfoods.com/orders", { cookie: true }).rewrite!).pathname).toBe("/admin/orders");
    expect(new URL(hit("https://admin.dorocityfoods.com/", { cookie: true }).rewrite!).pathname).toBe("/admin");
    expect(new URL(hit("https://admin.dorocityfoods.com/login").rewrite!).pathname).toBe("/admin/login");
  });

  it("sends signed-out visitors to sign in, remembering where they were going", () => {
    process.env.ADMIN_HOST = "admin.dorocityfoods.com";
    const r = hit("https://admin.dorocityfoods.com/orders/abc");
    expect(r.status).toBe(307);
    expect(r.location).toBe("https://admin.dorocityfoods.com/login?next=%2Forders%2Fabc");
  });

  it("canonicalises old /admin links on the admin host", () => {
    process.env.ADMIN_HOST = "admin.dorocityfoods.com";
    expect(hit("https://admin.dorocityfoods.com/admin/orders?status=CONFIRMED", { cookie: true })).toMatchObject({ status: 308, location: "https://admin.dorocityfoods.com/orders?status=CONFIRMED" });
  });

  it("never serves the admin on the shop domains", () => {
    process.env.ADMIN_HOST = "admin.dorocityfoods.com";
    expect(hit("https://www.dorocityfoods.com/admin/orders", { cookie: true })).toMatchObject({ status: 308, location: "https://admin.dorocityfoods.com/orders" });
    expect(hit("https://dorofood.vercel.app/admin")).toMatchObject({ status: 308, location: "https://admin.dorocityfoods.com/" });
    const shop = hit("https://www.dorocityfoods.com/shop");
    expect(shop.status).toBe(200);
    expect(shop.rewrite).toBeNull();
  });
});

describe("admin routing without ADMIN_HOST (local and preview)", () => {
  it("keeps the admin at /admin with a sign-in gate", () => {
    delete process.env.ADMIN_HOST;
    expect(hit("http://localhost:3000/admin/orders")).toMatchObject({ status: 307, location: "http://localhost:3000/admin/login?next=%2Fadmin%2Forders" });
    expect(hit("http://localhost:3000/admin/orders", { cookie: true }).status).toBe(200);
    expect(hit("http://localhost:3000/admin/login").status).toBe(200);
  });
});
