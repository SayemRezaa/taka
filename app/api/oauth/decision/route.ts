import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Records the approve/deny decision from the consent screen.
 *
 * The consent page only renders the choice; this is where it takes effect.
 * `approveAuthorization` is what actually mints the OAuth authorization code,
 * and it only works for the signed-in user whose cookies are on this request —
 * which is why the decision lives in a route with a session rather than
 * anywhere the MCP client could reach directly.
 *
 * Both outcomes end in a redirect back to the client, carrying either the code
 * or an error. That redirect target comes from Supabase, not from us.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const decision = form.get("decision");
  const authorizationId = form.get("authorization_id");

  if (typeof authorizationId !== "string" || !authorizationId) {
    return NextResponse.json({ error: "Missing authorization_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data, error } =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);

  if (error || !data?.redirect_url) {
    return NextResponse.json(
      { error: error?.message ?? "Could not record the decision." },
      { status: 400 },
    );
  }

  // 303 so the browser turns this POST into a GET on the client's callback.
  return NextResponse.redirect(data.redirect_url, 303);
}
