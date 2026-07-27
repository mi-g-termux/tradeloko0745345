// Moves the admin sign-in page to a private URL of your choosing.
//
// WHY THIS EXISTS
// ---------------
// /signin is a name every attacker guesses first. Setting ADMIN_LOGIN_PATH to
// something unguessable means the login form simply is not there to be found,
// and the default /signin returns a real 404.
//
// This runs on the edge runtime, so it deliberately does nothing but read an env
// var and rewrite a URL. No database, no crypto, no session logic - those all
// stay in the Node routes where they belong. Obscuring the URL is a LAYER; the
// actual security is still: existing account + admin role + allowlist + code.
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SEGMENT = "signin";

/** Strip slashes/whitespace and lowercase, so "/My-Door/" === "my-door". */
function normalize(input: string): string {
  return input.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}

// Read once at module scope. Env vars cannot change without a redeploy.
const CUSTOM_SEGMENT = normalize(process.env.ADMIN_LOGIN_PATH ?? "");
const IS_PRIVATE = CUSTOM_SEGMENT !== "" && CUSTOM_SEGMENT !== DEFAULT_SEGMENT;

export function middleware(req: NextRequest) {
  // Nothing configured: behave exactly as before, /signin stays the door.
  if (!IS_PRIVATE) return NextResponse.next();

  // Trailing slashes must not create a bypass.
  const path = (req.nextUrl.pathname.replace(/\/+$/, "") || "/").toLowerCase();

  // The private door renders the sign-in page without redirecting, so the
  // secret URL stays in the address bar and is never leaked in a Location header.
  if (path === "/" + CUSTOM_SEGMENT) {
    const url = req.nextUrl.clone();
    url.pathname = "/" + DEFAULT_SEGMENT;
    return NextResponse.rewrite(url);
  }

  // The default door is now closed. 404 (not 403) so a prober cannot tell the
  // difference between "moved" and "never existed".
  if (path === "/" + DEFAULT_SEGMENT) {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return NextResponse.next();
}

// Skip API routes and static assets - only page navigations matter here.
export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
