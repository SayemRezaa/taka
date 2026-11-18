import { LoginForm } from "./login-form";
import { safeRedirect } from "@/lib/redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const sp = await searchParams;
  const next = safeRedirect(sp.redirect);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-title font-semibold tracking-tight">Taka</h1>
      <p className="mt-2 text-small text-muted">
        A ledger for where your money actually goes.
      </p>
      {next && (
        <p className="mt-3 rounded-control border border-border bg-sunk px-3 py-2 text-small text-muted">
          Sign in to continue authorising access.
        </p>
      )}
      <LoginForm next={next} />
    </main>
  );
}
