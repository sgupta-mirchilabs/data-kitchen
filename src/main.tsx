import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MsalProvider } from "@azure/msal-react";
import "./index.css";
import App from "./App";
import { msalInstance, initializeMsal } from "./auth/authConfig";
import { SignInGate } from "./components/SignInGate";
import { OrganizationGate } from "./components/OrganizationGate";

const tree = (
  <StrictMode>
    <BrowserRouter>
      {msalInstance ? (
        <MsalProvider instance={msalInstance}>
          <SignInGate>
            {/* Inside SignInGate: organization lookup needs a bearer token. */}
            <OrganizationGate>
              <App />
            </OrganizationGate>
          </SignInGate>
        </MsalProvider>
      ) : (
        <App />
      )}
    </BrowserRouter>
  </StrictMode>
);

// MSAL must finish initialize() and handleRedirectPromise() before React renders,
// otherwise a sign-in redirect returning to the app races the first render.
initializeMsal().then(() => {
  createRoot(document.getElementById("root")!).render(tree);
});
