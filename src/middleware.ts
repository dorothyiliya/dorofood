import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap first gate for the admin: no session cookie, no admin pages. The real
 * check (session lookup, expiry, role) happens server-side on every page and action.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname !== "/admin/login" && !request.cookies.has("dfa_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
