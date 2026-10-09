import "@fontsource-variable/inter";
import "@fontsource-variable/inter-tight";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TakeIdentityProvider } from "./context/TakeIdentityContext";
import { TakeProductProvider } from "./context/TakeProductContext";
import { PrivyHost } from "./lib/privy";
import { prefetchCampaignFromLocation } from "./lib/publicCampaign";
import "./styles.css";
import "./home-preserved.css";
import "./recovered-functional.css";
import "./signal.css";
import "./sticker.css";
import "./landing-sky.css";
import "./landing-sections.css";
import "./sticker-surfaces.css";
import "./sticker-feeds.css";
import "./sticker-detail.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("TAKE could not find its root element.");
}

// A shared campaign link: fetch it while the campaign screen's code downloads.
prefetchCampaignFromLocation();

createRoot(root).render(
  <StrictMode>
    <TakeIdentityProvider>
      <TakeProductProvider>
        <App />
      </TakeProductProvider>
    </TakeIdentityProvider>
    <PrivyHost />
  </StrictMode>,
);
