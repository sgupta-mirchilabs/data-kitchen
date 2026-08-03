import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type Configuration,
  type AccountInfo,
} from "@azure/msal-browser";

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID;
const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID;
const apiScope = import.meta.env.VITE_ENTRA_API_SCOPE;

/**
 * Entra sign-in is active only when all three build-time variables are present.
 * Cloud builds set them; local development leaves them unset and falls back to
 * the development token path in api-client.ts.
 */
export const isEntraConfigured = Boolean(tenantId && clientId && apiScope);

// Narrow through the value rather than `isEntraConfigured` so `scopes` is
// string[] and not (string | undefined)[] — MSAL's request types reject the latter.
const scopes: string[] = apiScope ? [apiScope] : [];

export const loginRequest = { scopes };

const msalConfig: Configuration = {
  auth: {
    clientId: clientId ?? "",
    authority: `https://login.microsoftonline.com/${tenantId ?? "common"}`,
    redirectUri: typeof window !== "undefined" ? window.location.origin : "/",
    postLogoutRedirectUri: typeof window !== "undefined" ? window.location.origin : "/",
  },
  cache: {
    // sessionStorage keeps tokens out of long-lived browser storage; closing the
    // tab ends the session.
    cacheLocation: "sessionStorage",
  },
};

// Constructing PublicClientApplication with an empty clientId throws, so the
// instance only exists when Entra is configured.
export const msalInstance = isEntraConfigured ? new PublicClientApplication(msalConfig) : null;

let initialized: Promise<void> | null = null;

export function initializeMsal(): Promise<void> {
  if (!msalInstance) return Promise.resolve();
  if (!initialized) {
    initialized = msalInstance.initialize().then(async () => {
      // Completes a redirect sign-in if we just came back from Entra.
      const result = await msalInstance.handleRedirectPromise();
      if (result?.account) {
        msalInstance.setActiveAccount(result.account);
      } else if (!msalInstance.getActiveAccount()) {
        const [first] = msalInstance.getAllAccounts();
        if (first) msalInstance.setActiveAccount(first);
      }
    });
  }
  return initialized;
}

export function getActiveAccount(): AccountInfo | null {
  if (!msalInstance) return null;
  return msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null;
}

export async function signIn(): Promise<void> {
  if (!msalInstance) return;
  await initializeMsal();
  await msalInstance.loginRedirect(loginRequest);
}

export async function signOut(): Promise<void> {
  if (!msalInstance) return;
  await initializeMsal();
  await msalInstance.logoutRedirect({ account: getActiveAccount() ?? undefined });
}

/**
 * Returns a bearer token for the Data Kitchen API, or null when no user is
 * signed in. Silent acquisition uses the MSAL cache and refreshes as needed; a
 * genuine interaction requirement escalates to a redirect.
 */
export async function acquireAccessToken(): Promise<string | null> {
  if (!msalInstance) return null;
  await initializeMsal();

  const account = getActiveAccount();
  if (!account) return null;

  try {
    const result = await msalInstance.acquireTokenSilent({ ...loginRequest, account });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await msalInstance.acquireTokenRedirect({ ...loginRequest, account });
    }
    return null;
  }
}
