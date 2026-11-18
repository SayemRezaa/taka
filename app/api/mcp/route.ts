import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerTakaTools } from "@/lib/mcp/tools";
import { verifyMcpToken } from "@/lib/mcp/auth";

/**
 * The MCP endpoint.
 *
 * MCP is a protocol for letting an AI assistant call your functions. This
 * route is the whole server: `createMcpHandler` turns a set of registered
 * tools into a normal Web `Request -> Response` handler, and Next mounts it
 * like any other route.
 *
 * Stateless by design — no session is held between calls, so it survives
 * serverless where any given request may hit a cold instance.
 *
 * `withMcpAuth` sits in front with `required: true`: no valid bearer token,
 * no tools. On a 401 it emits a WWW-Authenticate challenge pointing at the
 * protected-resource metadata next door, which is how a client discovers
 * where to go and log in.
 */
const handler = createMcpHandler((server) => {
  registerTakaTools(server);
});

const authed = withMcpAuth(handler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authed as GET, authed as POST };
