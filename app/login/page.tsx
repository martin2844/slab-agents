import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import {
  AUTH_COOKIE_NAME,
  authStatus,
  validateSession,
} from "@/lib/auth/service";

export const dynamic = "force-dynamic";

function safeNextPath(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.startsWith("/") && !candidate.startsWith("//")
    ? candidate
    : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const nextPath = safeNextPath((await searchParams).next);
  const status = authStatus();
  if (!status.required) redirect(nextPath);

  const cookieStore = await cookies();
  if (validateSession(cookieStore.get(AUTH_COOKIE_NAME)?.value)) {
    redirect(nextPath);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6">
        <div className="mb-6">
          <p className="font-heading text-2xl font-[675] tracking-[-0.035em]">
            Slab
          </p>
          <h1 className="mt-4 text-lg font-semibold">Agent Workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your local control plane.
          </p>
        </div>
        {status.configured ? (
          <LoginForm nextPath={nextPath} />
        ) : (
          <div className="rounded-md border border-amber-700/30 bg-amber-50 p-3 text-sm text-amber-950">
            Administrator credentials are not configured. Run the password
            bootstrap command on the host before signing in.
          </div>
        )}
      </div>
    </div>
  );
}
