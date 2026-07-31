import { NextResponse, type NextRequest } from "next/server";

// -----------------------------------------------------------------------------
// This middleware is a UX gate, NOT the security boundary.
//
// It runs on the edge runtime, which cannot open the SQLite database, so it
// can only check whether a session cookie is *present* — it cannot verify
// that the token is real, unexpired, or belongs to an active user. A forged
// cookie gets past this and is then rejected by the real check.
//
// The actual authorization happens server-side on every request:
//   - pages call requirePageSession() (src/lib/auth/guard.ts)
//   - API routes call requireApiSession(), which also enforces role
//     permissions
// Both look the token up in the Session table and validate expiry + user
// status. Deleting this file would degrade the redirect experience but would
// not open a hole.
// -----------------------------------------------------------------------------

const SESSION_COOKIE = "kt_session";

const PUBLIC_PATHS = ["/login", "/api/v1/auth/login", "/api/v1/auth/logout"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasCookie) return NextResponse.next();

  // Unauthenticated API calls get a 401 rather than an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
