// Loaded lazily by PrivyHost. Everything heavy (Privy, viem, wallet SDKs) lives behind this import.
import { addRpcUrlOverrideToChain } from "@privy-io/chains";
import {
  PrivyProvider, useCreateWallet, useLinkAccount, useLogin, useLoginWithEmail, useLoginWithOAuth,
  usePrivy, useSendTransaction, useUnlinkOAuth, useUnlinkWallet, useUser, useWallets,
} from "@privy-io/react-auth";
import { useLayoutEffect } from "react";
import { monadTestnet } from "viem/chains";
import { dispatchPrivy, publishPrivy } from "./privy";

const appId = import.meta.env.VITE_PRIVY_APP_ID ?? "cmtls0nnn000w0ckvufffphgr";
const rpcUrl = import.meta.env.VITE_MONAD_TESTNET_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const takeChain = addRpcUrlOverrideToChain(monadTestnet, rpcUrl);

function relay(channel: "login" | "oauth" | "email" | "link", ...names: string[]) {
  return Object.fromEntries(names.map((name) => [name, (...args: unknown[]) => dispatchPrivy(channel, name, args)]));
}
const loginCallbacks = relay("login", "onComplete", "onError");
const oauthCallbacks = relay("oauth", "onComplete", "onError");
const emailCallbacks = relay("email", "onComplete", "onError");
const linkCallbacks = relay("link", "onSuccess", "onError");

function PrivyBridge() {
  const privy = usePrivy();
  const user = useUser();
  const wallets = useWallets();
  const send = useSendTransaction();
  const createWallet = useCreateWallet();
  const login = useLogin(loginCallbacks);
  const oauth = useLoginWithOAuth(oauthCallbacks);
  const email = useLoginWithEmail(emailCallbacks);
  const link = useLinkAccount(linkCallbacks);
  const unlinkOAuth = useUnlinkOAuth();
  const unlinkWallet = useUnlinkWallet();
  useLayoutEffect(() => {
    publishPrivy({ privy, user, wallets, send, createWallet, login, oauth, email, link, unlinkOAuth, unlinkWallet });
  });
  return null;
}

export default function PrivyRuntime() {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["twitter", "email", "wallet"],
        defaultChain: takeChain,
        supportedChains: [takeChain],
        embeddedWallets: { ethereum: { createOnLogin: "off" } },
        appearance: { theme: "dark", accentColor: "#c8f05a" },
      }}
    >
      <PrivyBridge />
    </PrivyProvider>
  );
}
