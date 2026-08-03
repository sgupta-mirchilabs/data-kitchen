/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin in cloud builds, e.g. https://<app>.azurewebsites.net/api/v1.
   *  When unset the client falls back to the same-origin path "/api/v1", which only
   *  works behind a local dev proxy — never in the deployed Static Web App. */
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_FORCE_DEMO?: string;

  /** Entra sign-in. All three must be present for MSAL to activate. */
  readonly VITE_ENTRA_TENANT_ID?: string;
  /** Client ID of the SPA registration (data-kitchen-web-dev). */
  readonly VITE_ENTRA_CLIENT_ID?: string;
  /** api://<api-registration-client-id>/access_as_user */
  readonly VITE_ENTRA_API_SCOPE?: string;

  /** Local development only. Never set in a cloud build — a shared bearer token
   *  compiled into a published bundle is readable by anyone who downloads it. */
  readonly VITE_DEV_AUTH_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
