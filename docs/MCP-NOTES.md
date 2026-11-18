# MCP notes

Written for the version of you who comes back to this in six months.

## What MCP actually is

An AI assistant can only use words unless you give it functions to call. MCP
(Model Context Protocol) is the agreed shape of those functions, so that any
assistant can talk to any server without a custom integration for each pair.

It is less exotic than it sounds. `/api/mcp` is an ordinary HTTP endpoint. A
client POSTs JSON-RPC to it: "list your tools", then "call `add_entry` with
these arguments". The server answers with text. The only reason a protocol
exists at all is so Claude, ChatGPT, Cursor and anything else can each speak
to Taka without knowing anything about Taka in advance.

**Stateless** matters here. Our endpoint holds nothing between calls. Each
request carries everything needed to answer it. That is what lets it run on
Vercel, where two consecutive requests may land on different machines and the
one that held your session may no longer exist.

## Why the auth is more complicated than a password

The hard problem is not "is this user real". It is: *an AI client, running on
someone else's computer, wants to act as you, and must never see your
password.* That is exactly the problem OAuth was invented for.

### OAuth 2.1, in the order it happens

1. The client POSTs to `/api/mcp` with no token. It gets **401** and a
   `WWW-Authenticate` header pointing at
   `/.well-known/oauth-protected-resource`.
2. It fetches that document. It says: the authorization server for this
   resource is `https://<ref>.supabase.co/auth/v1`.
3. It fetches *Supabase's* discovery document and learns where to send people
   to authorize, and where to swap a code for a token.
4. It opens your browser at Supabase's authorize endpoint. Supabase parks the
   request and sends you to **our** consent page with an `authorization_id`.
5. You approve. `approveAuthorization()` mints a short-lived
   **authorization code** and redirects back to the client.
6. The client swaps that code for an **access token** plus a refresh token.
7. Every later call carries `Authorization: Bearer <token>`.

Nobody typed a password into the AI client. You typed it into Taka, on
Taka's domain, as always.

### PKCE, and the problem it solves

The authorization code comes back through a browser redirect — a URL. URLs
leak: into logs, into history, into another app that registered the same
custom scheme. If an attacker grabs the code, could they swap it for a token?

PKCE (Proof Key for Code Exchange) says no. Before starting, the client
invents a random secret (the *verifier*), hashes it, and sends only the hash
(the *challenge*). When it later redeems the code, it must present the
original verifier. The authorization server hashes it and checks it matches.
A stolen code is useless without the verifier, which never travelled over the
network.

It is required in OAuth 2.1 rather than optional, because a public client — a
desktop app, a mobile app, anything whose binary you can read — cannot keep a
client secret secret. PKCE replaces "prove you know the secret" with "prove
you are the same party that started this flow".

### Dynamic client registration

Normally you pre-register an app and paste a client ID into it. That does not
scale to "any MCP client anyone might use". DCR lets a client register itself
at Supabase's `/oauth/clients/register` and receive its own ID — which is why
pasting a URL into claude.ai is the entire setup.

The trade: anyone can register. That is why the consent screen shows the
client name and its redirect address, and why `MCP_ALLOWED_USER_IDS` exists.
Registration is not authorization.

## The files

| File | What it does |
|---|---|
| `app/api/mcp/route.ts` | The server. `createMcpHandler` turns the tools into a `Request -> Response` function; `withMcpAuth(required: true)` refuses anything without a valid token and emits the 401 challenge that starts discovery. |
| `app/.well-known/oauth-protected-resource/route.ts` | Step 2 above. A signpost saying "Supabase authorizes this resource". Needs CORS because a browser often fetches it. |
| `lib/mcp/auth.ts` | Verifies the bearer JWT against Supabase's JWKS, checks issuer and expiry, enforces the allowlist, hands back `sub` as the user id. The JWKS is built lazily so a missing env var reports cleanly instead of crashing on import. |
| `lib/mcp/tools.ts` | The eight tools. Zod schema in, one-line summary plus compact JSON out. |
| `lib/mcp/format.ts` | Reply shaping, category matching, confirm tokens, the duplicate predicate — the pure logic, kept separate so it can be tested without a database. |
| `app/oauth/consent/page.tsx` | Step 4. Shows who is asking and what they want. |
| `app/api/oauth/decision/route.ts` | Step 5. Calls approve or deny and redirects back to the client. |
| `db/mutations.ts` | Writes, `userId` first. New because there are now two front doors — session cookie and bearer token — and one copy of the ownership checks is better than two. |
| `lib/redirect.ts` | `safeRedirect`. An open redirect on a page that hands out OAuth codes is worth real money, so only same-site absolute paths are allowed. |

## Things that will bite you

**Middleware eats everything by default.** `lib/supabase/middleware.ts`
redirects any path without a session cookie to `/login`. An MCP client has a
token, not a cookie. `/api/mcp` and `/.well-known` are in `PUBLIC_PATHS` for
that reason — remove them and the endpoint answers protocol requests with a
login page, which presents as a baffling parse error on the client.

**The audience claim is not doing what you might assume.** Supabase issues
OAuth tokens with `aud: "authenticated"`, not this server's URL. Proper
RFC 8707 audience binding needs a Custom Access Token Hook. Until then the
real gate is `MCP_ALLOWED_USER_IDS`, and it fails closed — empty means nobody,
including you. If the tools suddenly 401 after a deploy, check that variable
first.

**Asymmetric signing keys are required.** Verification pulls a public key from
Supabase's JWKS. With HS256 there is no public key and none of this works.
This project is on ES256.

**Site URL must not have a trailing slash**, or the authorization URL comes
out with `//` in the middle.

## Testing it locally

```bash
npx @modelcontextprotocol/inspector
```

Point it at `http://localhost:3000/api/mcp` with Streamable HTTP. It will walk
the discovery chain, send you through consent, and then let you call tools by
hand. Without the real Supabase keys in `.env.local` you will get as far as
the 401 challenge and no further — which is itself a useful check.
