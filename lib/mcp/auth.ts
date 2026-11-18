import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/server";

/**
 * Who is calling the MCP endpoint, and may they.
 *
 * The web app learns the user from a session cookie. An MCP client has no
 * cookie — it presents a bearer JWT that Supabase Auth issued through the
 * OAuth 2.1 flow. Hard rule 2 says the user id must never come from the
 * request, and this does not break it: the id is read from a token whose
 * signature is verified against Supabase's public keys. An attacker cannot
 * mint one without the private key, which never leaves Supabase. A `userId`
 * field in a tool's arguments would be untrusted input; `sub` in a verified
 * JWT is not.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/** Must match the `issuer` in the project's OAuth discovery document. */
export const MCP_ISSUER = `${SUPABASE_URL}/auth/v1`;

/**
 * Remote key set, cached and refreshed by jose. Supabase signs with ES256
 * (asymmetric), so we verify with the public key and never hold a secret.
 *
 * Built on first use, not at module load: with the env var missing the URL is
 * relative and `new URL` throws, which would take down anything that merely
 * imports this file — including the tests and a build on a misconfigured
 * deploy — before verifyBearer could report it cleanly.
 */
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  jwksCache ??= createRemoteJWKSet(
    new URL(`${MCP_ISSUER}/.well-known/jwks.json`),
  );
  return jwksCache;
}

export function allowedUserIds(): string[] {
  return (process.env.MCP_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Fail closed. An empty or missing allowlist denies everyone, including the
 * owner. Signup is open on this project, so treating "not configured" as "no
 * restriction" would hand the tools to anyone who registers an account; a
 * deploy that forgot the variable should lock the door, not remove it.
 */
export function isAllowed(userId: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  return allowlist.includes(userId);
}

/**
 * Supabase issues OAuth tokens with `aud: "authenticated"` rather than this
 * server's URL, so RFC 8707 audience binding is not available without a
 * Custom Access Token Hook. We accept that audience (or none) and rely on
 * issuer, signature, expiry and the allowlist. Documented rather than
 * silently skipped.
 */
const ACCEPTED_AUDIENCES = new Set(["authenticated"]);

export type VerifyOutcome =
  | {
      ok: true;
      userId: string;
      clientId: string;
      scopes: string[];
      expiresAt?: number;
    }
  | {
      ok: false;
      reason: "no_token" | "invalid_token" | "not_allowed" | "not_configured";
    };

export async function verifyBearer(
  bearerToken: string | undefined,
): Promise<VerifyOutcome> {
  if (!bearerToken) return { ok: false, reason: "no_token" };
  if (!SUPABASE_URL) return { ok: false, reason: "not_configured" };

  let payload;
  try {
    // jose checks the signature against the JWKS and enforces exp/nbf.
    ({ payload } = await jwtVerify(bearerToken, jwks(), {
      issuer: MCP_ISSUER,
    }));
  } catch {
    return { ok: false, reason: "invalid_token" };
  }

  const aud = payload.aud;
  const auds = aud === undefined ? [] : Array.isArray(aud) ? aud : [aud];
  if (auds.length > 0 && !auds.some((a) => ACCEPTED_AUDIENCES.has(a))) {
    return { ok: false, reason: "invalid_token" };
  }

  const userId = typeof payload.sub === "string" ? payload.sub : "";
  if (!userId) return { ok: false, reason: "invalid_token" };

  if (!isAllowed(userId, allowedUserIds())) {
    return { ok: false, reason: "not_allowed" };
  }

  const scopeClaim = payload.scope;
  const scopes =
    typeof scopeClaim === "string" ? scopeClaim.split(" ").filter(Boolean) : [];

  return {
    ok: true,
    userId,
    clientId:
      typeof payload.client_id === "string" ? payload.client_id : "unknown",
    scopes,
    expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}

/** The shape `withMcpAuth` wants. Returning undefined produces a 401. */
export async function verifyMcpToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  const result = await verifyBearer(bearerToken);
  if (!result.ok) return undefined;

  return {
    token: bearerToken!,
    clientId: result.clientId,
    scopes: result.scopes,
    expiresAt: result.expiresAt,
    extra: { userId: result.userId },
  };
}

/** Pulls the verified user id back out inside a tool handler. */
export function userIdFrom(authInfo: AuthInfo | undefined): string {
  const id = authInfo?.extra?.userId;
  if (typeof id !== "string" || !id) {
    // Unreachable while withMcpAuth runs with required: true, but a tool must
    // never fall back to an unscoped query if that ever changes.
    throw new Error("No verified user on this request.");
  }
  return id;
}
