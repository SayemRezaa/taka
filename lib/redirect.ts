/**
 * Validates a `?redirect=` value before we send a browser to it.
 *
 * The OAuth consent flow has to bounce a signed-out user through sign-in and
 * back, carrying an `authorization_id`. That means a redirect target arrives
 * in a query string, which is untrusted input: left unchecked it is an open
 * redirect, and an open redirect on a page that hands out OAuth codes is worth
 * real money to an attacker.
 *
 * Only a same-site absolute path is allowed. Rejected:
 *   //evil.com/x          protocol-relative, a browser treats it as a host
 *   https://evil.com      absolute
 *   /\evil.com            backslash, which some browsers normalise to /
 *   ../x                  relative, resolves against the current path
 */
export function safeRedirect(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  if (value.includes("://")) return null;
  return value;
}
