import type { ReactNode } from "react";
import { useIsAuthenticated } from "@azure/msal-react";
import { signIn } from "../auth/authConfig";

/**
 * Blocks the application until a Mirchi Labs account is signed in.
 *
 * Only rendered when Entra is configured (cloud builds). Local development
 * bypasses this entirely — see main.tsx. Organization selection happens
 * downstream in OrganizationGate.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const isAuthenticated = useIsAuthenticated();

  if (isAuthenticated) return <>{children}</>;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--background)",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 32,
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "var(--mirchi)",
            margin: "0 auto 16px",
          }}
        />
        <h1 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>
          Data Kitchen
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "8px 0 0" }}>
          Sign in with your Mirchi Labs account to continue.
        </p>
        <button
          type="button"
          onClick={() => void signIn()}
          style={{
            marginTop: 24,
            width: "100%",
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 500,
            color: "#fff",
            background: "var(--mirchi)",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
