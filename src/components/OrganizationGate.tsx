import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  ApiClientError,
  getSelectedOrganization,
  setSelectedOrganization,
  clearSelectedOrganization,
} from "../lib/api-client";
import { signOut, getActiveAccount } from "../auth/authConfig";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role: string;
}

type State =
  | { phase: "loading" }
  | { phase: "choosing"; organizations: Organization[] }
  | { phase: "ready"; organization: Organization | null }
  | { phase: "error"; message: string };

/**
 * Resolves which organization the session operates as, before rendering the app.
 *
 * The API refuses tenant-scoped requests from a user with more than one active
 * membership unless X-Organization-Id is supplied — it answers 400
 * ORGANIZATION_REQUIRED rather than guessing. api-client reads the selection
 * from sessionStorage, but nothing previously wrote it, so a multi-organization
 * user could never get past that error. This component supplies it.
 *
 * Selection is a client-side convenience only. The server re-validates the
 * header against active memberships on every request, so choosing here grants
 * nothing that the membership does not already allow.
 */
export function OrganizationGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        // /me/organizations is an auth-only route: it bypasses tenant
        // resolution, so it succeeds even when no organization is selected.
        const { data: organizations } = await api.get<Organization[]>("/me/organizations");
        if (cancelled) return;

        if (organizations.length === 0) {
          setState({
            phase: "error",
            message: "Your account has no active organization membership.",
          });
          return;
        }

        const stored = getSelectedOrganization();
        const storedIsValid = stored && organizations.some((o) => o.id === stored);

        if (storedIsValid) {
          setState({
            phase: "ready",
            organization: organizations.find((o) => o.id === stored) ?? null,
          });
          return;
        }

        // A stored id that is no longer a membership must not be sent again.
        if (stored && !storedIsValid) clearSelectedOrganization();

        if (organizations.length === 1) {
          setSelectedOrganization(organizations[0].id);
          setState({ phase: "ready", organization: organizations[0] });
          return;
        }

        setState({ phase: "choosing", organizations });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof ApiClientError
            ? `${err.code}: ${err.message}`
            : "Could not reach the Data Kitchen API.";
        setState({ phase: "error", message });
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  function choose(org: Organization) {
    setSelectedOrganization(org.id);
    setState({ phase: "ready", organization: org });
  }

  function switchOrganization() {
    clearSelectedOrganization();
    setState({ phase: "loading" });
    // Re-run resolution by remounting the effect via a full reload; this also
    // clears any tenant-scoped data already held in component state.
    window.location.reload();
  }

  if (state.phase === "loading") {
    return <Centered>Loading your organizations…</Centered>;
  }

  if (state.phase === "error") {
    return (
      <Centered>
        <p style={{ color: "var(--text-primary)", margin: "0 0 8px", fontWeight: 600 }}>
          Cannot open a workspace
        </p>
        <p style={{ color: "var(--text-secondary)", margin: "0 0 20px", fontSize: 13 }}>
          {state.message}
        </p>
        <SecondaryButton onClick={() => void signOut()}>Sign out</SecondaryButton>
      </Centered>
    );
  }

  if (state.phase === "choosing") {
    return (
      <Centered wide>
        <p style={{ color: "var(--text-primary)", margin: "0 0 4px", fontWeight: 600 }}>
          Choose an organization
        </p>
        <p style={{ color: "var(--text-secondary)", margin: "0 0 20px", fontSize: 13 }}>
          You belong to more than one. All data you see is scoped to your choice.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {state.organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => choose(org)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>
                {org.name}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                {org.role.replace(/_/g, " ")}
              </span>
            </button>
          ))}
        </div>
      </Centered>
    );
  }

  return (
    <>
      <SessionBar organization={state.organization} onSwitch={switchOrganization} />
      {children}
    </>
  );
}

function SessionBar({
  organization,
  onSwitch,
}: {
  organization: Organization | null;
  onSwitch: () => void;
}) {
  const account = getActiveAccount();
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 16px",
        fontSize: 12,
        color: "var(--text-secondary)",
      }}
    >
      {organization && (
        <>
          <span style={{ color: "var(--text-primary)" }}>{organization.name}</span>
          <SecondaryButton onClick={onSwitch}>Switch</SecondaryButton>
        </>
      )}
      <span>{account?.username}</span>
      <SecondaryButton onClick={() => void signOut()}>Sign out</SecondaryButton>
    </div>
  );
}

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "4px 10px",
        fontSize: 12,
        color: "var(--text-secondary)",
        background: "var(--surface-raised)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Centered({ children, wide }: { children: ReactNode; wide?: boolean }) {
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
          maxWidth: wide ? 420 : 380,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 28,
          color: "var(--text-secondary)",
          fontSize: 13,
        }}
      >
        {children}
      </div>
    </div>
  );
}
