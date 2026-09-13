import "@fontsource-variable/inter";
import "@fontsource-variable/inter-tight";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { addRpcUrlOverrideToChain } from "@privy-io/chains";
import { PrivyProvider } from "@privy-io/react-auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { monadTestnet } from "viem/chains";
import { App } from "./App";
import { TakeIdentityProvider } from "./context/TakeIdentityContext";
import { TakeProductProvider } from "./context/TakeProductContext";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("TAKE could not find its root element.");
}

const appId = import.meta.env.VITE_PRIVY_APP_ID ?? "cmtls0nnn000w0ckvufffphgr";
const rpcUrl = import.meta.env.VITE_MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const takeChain = addRpcUrlOverrideToChain(monadTestnet, rpcUrl);

createRoot(root).render(
  <StrictMode>
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["twitter", "email", "wallet"],
        defaultChain: takeChain,
        supportedChains: [takeChain],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "off",
          },
        },
        appearance: {
          theme: "dark",
          accentColor: "#c8f05a",
        },
      }}
    >
      <TakeIdentityProvider>
        <TakeProductProvider>
          <App />
        </TakeProductProvider>
      </TakeIdentityProvider>
    </PrivyProvider>
  </StrictMode>,
);
