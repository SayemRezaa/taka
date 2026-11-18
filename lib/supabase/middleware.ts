import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirect } from "@/lib/redirect";

/**
 * Paths that must never be bounced to the sign-in page.
 *
 * `/api/mcp` and `/.well-known` are machine endpoints. An MCP client arrives
 * with a bearer token and no session cookie, so redirecting it would answer a
 * protocol request with a login page. They authenticate themselves.
 *
 * `/oauth/consent` is reached by a signed-out user in the middle of an OAuth
 * flow. The page redirects to sign-in itself, preserving the
 * `authorization_id`, which a redirect from here would discard.
 */
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/oauth/consent",
  "/api/mcp",
  "/.well-known",
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the token with Supabase. Do not swap this for
  // getSession(), which trusts the cookie without checking it.
  const { data } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!data.user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (data.user && path === "/login") {
    // Honour ?redirect= so a signed-in user who lands here mid-OAuth is sent
    // on to consent rather than dumped at the ledger with the flow lost.
    const target =
      safeRedirect(request.nextUrl.searchParams.get("redirect")) ?? "/ledger";
    return NextResponse.redirect(new URL(target, request.url));
  }

  return response;
}
