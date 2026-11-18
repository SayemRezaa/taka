import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";

/**
 * RFC 9728 protected-resource metadata.
 *
 * This is the signpost. A client that hits /api/mcp without a token gets a
 * 401 pointing here; this document then says "the authorization server for
 * this resource is Supabase, at that URL". The client reads Supabase's own
 * discovery document from there, registers itself, and starts the OAuth
 * flow. None of that is configured in the client by hand — the two documents
 * are what make a connector work from just a URL.
 *
 * CORS matters because the client fetching this is often a browser.
 */
const handler = protectedResourceHandler({
  authServerUrls: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
});

const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
