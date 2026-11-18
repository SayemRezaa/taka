import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The OAuth consent screen.
 *
 * Supabase Auth is the authorization server, but it does not own a UI. When an
 * MCP client starts an OAuth flow, Supabase parks the request and sends the
 * browser here with an `authorization_id`. This page is where you, the human,
 * see who is asking and decide. Approving mints the authorization code; the
 * SDK does that part when `/api/oauth/decision` calls `approveAuthorization`.
 *
 * Its path is configured in the dashboard under Authentication > OAuth Server
 * as the Authorization Path, and combined with Site URL to form the full URL.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const { authorization_id: authorizationId } = await searchParams;

  if (!authorizationId) {
    return <Problem title="Missing authorization" detail="No authorization_id in the URL." />;
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    // Preserve the whole URL so the flow survives the round trip through
    // sign-in. Middleware lets this path through precisely so we can do this.
    const back = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    redirect(`/login?redirect=${encodeURIComponent(back)}`);
  }

  const { data: details, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !details) {
    return (
      <Problem
        title="Authorization request not valid"
        detail={error?.message ?? "It may have expired. Start again from the client."}
      />
    );
  }

  // Already consented previously — Supabase hands back a redirect instead of
  // details, and there is nothing left to ask.
  if (!("authorization_id" in details)) {
    redirect((details as { redirect_url: string }).redirect_url);
  }

  const client = details.client;
  const scopes = (details.scope ?? "").split(" ").filter(Boolean);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <section className="card p-5">
        <p className="text-micro text-muted">Authorisation request</p>
        <h1 className="mt-1 text-title font-semibold tracking-tight">
          {client?.name ?? "An application"} wants access to your ledger
        </h1>
        <p className="mt-2 text-small text-muted">
          Signed in as {userData.user.email}. Approving lets this client read and
          write your entries through Taka&apos;s MCP endpoint, as you.
        </p>

        <dl className="mt-4 space-y-2 border-t border-border-soft pt-4 text-small">
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-muted">Client</dt>
            <dd className="min-w-0 flex-1 break-words">{client?.name ?? "Unknown"}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-muted">Redirects to</dt>
            <dd className="min-w-0 flex-1 break-all">{details.redirect_uri}</dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-muted">Scopes</dt>
            <dd className="min-w-0 flex-1">
              {scopes.length === 0 ? (
                <span className="text-muted">none requested</span>
              ) : (
                <ul className="flex flex-wrap gap-1">
                  {scopes.map((s) => (
                    <li
                      key={s}
                      className="num rounded-full bg-sunk px-2 py-0.5 text-micro"
                    >
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>

        <p className="mt-4 text-micro text-muted">
          Only approve a client you started yourself. The redirect address above
          is where the authorisation code is sent — if you do not recognise it,
          deny.
        </p>

        <form
          action="/api/oauth/decision"
          method="POST"
          className="mt-5 flex gap-2"
        >
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-control border border-border py-2.5 text-small font-medium"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 rounded-control bg-accent py-2.5 text-small font-semibold text-white"
          >
            Approve
          </button>
        </form>
      </section>
    </main>
  );
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <section className="card p-5">
        <h1 className="text-title font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-small text-muted">{detail}</p>
      </section>
    </main>
  );
}
