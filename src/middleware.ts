import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "dfa_session";
const PREFIX = "/admin";

/**
 * Admin routing.
 *
 * With ADMIN_HOST set (production: admin.dorocityfoods.com) the admin lives only
 * on that host, at clean paths ("/" is the dashboard, "/orders" the orders list).
 * Internally the routes stay under /admin, so this rewrites "/orders" to
 * "/admin/orders" and canonicalises any "/admin/..." link back to "/orders".
 * The shop domains never serve the admin: "/admin..." there redirects to the
 * admin host, which also keeps the session cookie off the public site.
 *
 * Without ADMIN_HOST (local development, preview deployments) the admin is
 * served at /admin on the same host.
 *
 * This is only the first gate (cookie present); every admin page and action
 * re-checks the session and role on the server.
 */
export function middleware(request: NextRequest) {
  const adminHost = process.env.ADMIN_HOST?.trim().toLowerCase();
  const host = (request.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const { pathname } = request.nextUrl;
  const adminPath = pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
  const strip = (path: string) => path.slice(PREFIX.length) || "/";

  if (adminHost && host === adminHost) {
    if (pathname.startsWith("/api/")) return NextResponse.next();
    if (adminPath) return redirect(request, strip(pathname), 308);
    if (pathname !== "/login" && !request.cookies.has(SESSION_COOKIE)) {
      return redirect(request, "/login", 307, pathname === "/" ? null : pathname);
    }
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? PREFIX : `${PREFIX}${pathname}`;
    return adminHeaders(NextResponse.rewrite(url));
  }

  if (!adminPath) return NextResponse.next();
  if (adminHost) {
    const url = new URL(strip(pathname) + request.nextUrl.search, `https://${adminHost}`);
    return NextResponse.redirect(url, 308);
  }
  if (pathname !== `${PREFIX}/login` && !request.cookies.has(SESSION_COOKIE)) {
    return redirect(request, `${PREFIX}/login`, 307, pathname === PREFIX ? null : pathname);
  }
  return adminHeaders(NextResponse.next());
}

function redirect(request: NextRequest, pathname: string, status: 307 | 308, next: string | null = null) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  if (status === 307) url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url, status);
}

function adminHeaders(response: NextResponse) {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  // Everything except build assets and static files, so the admin host can be routed at its root.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|brand/|.*\\.(?:png|jpe?g|svg|webp|ico|txt|xml)$).*)"],
};
