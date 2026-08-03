import type { ReactNode } from "react";
import { useIsAuthenticated } from "@azure/msal-react";
import { signIn, signOut, getActiveAccount } from "../auth/authConfig";

/**
 * Blocks the application until a Mirchi Labs account is signed in.
 *
 * Only rendered when Entra is configured (cloud builds). Local development
 * bypasses this entirely — see main.tsx.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Data Kitchen</h1>
          <p className="mt-2 text-sm text-slate-600">
            Sign in with your Mirchi Labs account to continue.
          </p>
          <button
            type="button"
            onClick={() => void signIn()}
            className="mt-6 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Sign in with Microsoft
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <SignedInBar />
      {children}
    </>
  );
}

function SignedInBar() {
  const account = getActiveAccount();
  return (
    <div className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm">
      <span className="text-slate-600">{account?.username}</span>
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}
