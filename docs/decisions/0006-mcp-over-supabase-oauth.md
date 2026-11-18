# 6. An MCP endpoint, authenticated by Supabase's OAuth server

Date: 2026-11-18 · Status: accepted

## Context

Entry has to take under ten seconds from a cold open, and the fastest path is
often not the app at all — it is telling an assistant "120 taka lunch, bKash"
while walking. That needs a way for an AI client to read and write the ledger
as me, from a phone, without holding my password.

## Decision

A stateless Streamable HTTP MCP server at `/api/mcp`, with Supabase Auth
acting as the OAuth 2.1 authorization server. Tools reuse `db/queries.ts` and
a new `db/mutations.ts`. Authorization is a JWT verified against Supabase's
JWKS, plus an explicit allowlist of user ids.

## Reasoning

Supabase is already the identity provider, so an MCP client authenticates as
an existing Taka user rather than through a second, parallel auth system. The
alternative — a long-lived API key in the client's config — is a password that
never expires, cannot be scoped, and would sit in a settings file on every
device I ever connect.

[ADR 3](0003-supabase-auth-own-api.md) said the browser never queries Supabase
directly; all data goes through our own server code. MCP does not change that.
The route is server code: it verifies a token, extracts a user id, and calls
the same query functions the web app calls.

Hard rule 2 says `user_id` comes from the session, never from the request.
A bearer token arrives in a header, which looks superficially like a
violation. It is not: the id is read from the `sub` claim of a JWT whose
signature is checked against Supabase's public keys. Forging one requires the
private key, which never leaves Supabase. The rule's real content is "never
trust a user id the caller simply asserts", and a verified signature is the
strongest form of not-simply-asserting available.

Writes moved to `db/mutations.ts` because there are now two front doors with
different ways of learning who the user is. The domain-ownership checks have
to be identical in both, and the reliable way to keep two things identical is
for there to be one of them.

Two guards exist because an assistant acts quickly and in bulk, and a wrong
write is discovered weeks later when a total looks off:

- `add_entry` refuses a same-date, same-category, same-amount entry unless
  forced, since a sweep of phone notes will re-enter what was already typed.
- `update_entry` and `delete_entry` return a preview and a `confirm_token`
  hashed from the proposed values. Confirming a different change than the one
  previewed fails, which a bare `confirm: true` would not catch.

The allowlist fails closed. Signup is open on this project, so treating an
unset `MCP_ALLOWED_USER_IDS` as "no restriction" would hand the tools to
anyone who registers. A misconfigured deploy should lock the owner out, not
let strangers in.

## Consequences

Audience binding is weaker than RFC 8707 describes. Supabase issues OAuth
tokens with `aud: "authenticated"` rather than this server's identifier, so
a token minted for another resource in the same project would verify here.
The allowlist is what makes that acceptable for a single-user app; a Custom
Access Token Hook would close it properly if this ever has more than one user.

No schema change, so the SR-Wiki sync contract is untouched.

Middleware had to learn about machine endpoints. It previously redirected
every cookie-less request to `/login`, which would have answered protocol
requests with HTML.
