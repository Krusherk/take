// Privy, viem and the wallet SDKs are large. The landing page and public campaign
// links paint without them; this module stands in for "@privy-io/react-auth" with
// the same hook names and loads the real SDK in the background (immediately when
// a session or OAuth return is likely, otherwise on first interaction or idle).
// The real hooks run once, inside PrivyRuntime, and publish into this store.
import type * as PrivyTypes from "@privy-io/react-auth";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";

type LoginCallbacks = Parameters<typeof PrivyTypes.useLogin>[0];
type OAuthCallbacks = Parameters<typeof PrivyTypes.useLoginWithOAuth>[0];
type EmailCallbacks = Parameters<typeof PrivyTypes.useLoginWithEmail>[0];
type LinkCallbacks = Parameters<typeof PrivyTypes.useLinkAccount>[0];

export interface PrivyBridgeSnapshot {
  privy: ReturnType<typeof PrivyTypes.usePrivy>;
  user: ReturnType<typeof PrivyTypes.useUser>;
  wallets: ReturnType<typeof PrivyTypes.useWallets>;
  send: ReturnType<typeof PrivyTypes.useSendTransaction>;
  createWallet: ReturnType<typeof PrivyTypes.useCreateWallet>;
  login: ReturnType<typeof PrivyTypes.useLogin>;
  oauth: ReturnType<typeof PrivyTypes.useLoginWithOAuth>;
  email: ReturnType<typeof PrivyTypes.useLoginWithEmail>;
  link: ReturnType<typeof PrivyTypes.useLinkAccount>;
  unlinkOAuth: ReturnType<typeof PrivyTypes.useUnlinkOAuth>;
  unlinkWallet: ReturnType<typeof PrivyTypes.useUnlinkWallet>;
}

type Channel = "login" | "oauth" | "email" | "link";
type AnyCallbacks = Record<string, ((...args: never[]) => unknown) | undefined>;

let snapshot: PrivyBridgeSnapshot | null = null;
const listeners = new Set<() => void>();
const readyWaiters = new Set<() => void>();
const callbacks: Record<Channel, Set<{ current: AnyCallbacks | undefined }>> = {
  login: new Set(), oauth: new Set(), email: new Set(), link: new Set(),
};

/** Called by PrivyRuntime on every render of the real hooks. */
export function publishPrivy(next: PrivyBridgeSnapshot) {
  snapshot = next;
  if (next.privy.ready) { readyWaiters.forEach((resolve) => resolve()); readyWaiters.clear(); }
  listeners.forEach((listener) => listener());
}

/** The real hooks' callbacks fan out to every mounted facade hook of the same kind. */
export function dispatchPrivy(channel: Channel, name: string, args: unknown[]) {
  callbacks[channel].forEach((ref) => (ref.current?.[name] as ((...a: unknown[]) => unknown) | undefined)?.(...args));
}

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function useBridge<T>(select: (current: PrivyBridgeSnapshot) => T, fallback: T): T {
  return useSyncExternalStore(subscribe, () => snapshot ? select(snapshot) : fallback, () => fallback);
}

// ---- loading -------------------------------------------------------------
let requested = false;
const requestListeners = new Set<() => void>();

export function loadPrivy() {
  if (requested) return;
  requested = true;
  requestListeners.forEach((listener) => listener());
}

function whenReady(): Promise<PrivyBridgeSnapshot> {
  loadPrivy();
  if (snapshot?.privy.ready) return Promise.resolve(snapshot);
  return new Promise((resolve) => readyWaiters.add(() => resolve(snapshot!)));
}

/** True when a Privy session, OAuth return, or a signed-in route makes Privy needed right away. */
export function privyNeededNow(location: Pick<Location, "pathname" | "search"> = window.location) {
  if (/privy_/i.test(location.search)) return true;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      if (window.localStorage.key(index)?.startsWith("privy:")) return true;
    }
  } catch { /* storage blocked: fall through */ }
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const publicPath = path === "/" || /^\/campaign\/[^/]+$/.test(path) || /^\/(invite|r)\//.test(path);
  return !publicPath;
}

const PrivyRuntime = lazy(() => import("./privyRuntime"));

/** Mount once next to the app. Renders nothing visible until a Privy modal opens. */
export function PrivyHost() {
  const [load, setLoad] = useState(requested);
  useEffect(() => {
    const start = () => setLoad(true);
    requestListeners.add(start);
    if (requested) start();
    else if (privyNeededNow()) loadPrivy();
    else {
      // Signed-out visitors: fetch Privy on first interaction, or once the page is idle.
      const intent = () => loadPrivy();
      const events = ["pointerdown", "keydown", "touchstart", "focusin"] as const;
      events.forEach((name) => window.addEventListener(name, intent, { once: true, passive: true, capture: true }));
      const idle = window.setTimeout(() => {
        const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
        if (ric) ric(() => loadPrivy(), { timeout: 2_000 }); else loadPrivy();
      }, 3_500);
      return () => {
        requestListeners.delete(start);
        events.forEach((name) => window.removeEventListener(name, intent, { capture: true }));
        window.clearTimeout(idle);
      };
    }
    return () => { requestListeners.delete(start); };
  }, []);
  return load ? <Suspense fallback={null}><PrivyRuntime /></Suspense> : null;
}

// ---- facade hooks (same names and shapes the app uses) ----------------------
function useCallbacks(channel: Channel, value: AnyCallbacks | undefined) {
  const ref = useRef(value);
  ref.current = value;
  useEffect(() => {
    const entry = ref;
    callbacks[channel].add(entry);
    return () => { callbacks[channel].delete(entry); };
  }, [channel]);
}

const getAccessToken = async () => snapshot?.privy.ready ? snapshot.privy.getAccessToken() : (await whenReady()).privy.getAccessToken();
const logout = async () => (await whenReady()).privy.logout();
const refreshUser = async () => (await whenReady()).user.refreshUser();
const sendTransaction = (async (...args: Parameters<PrivyBridgeSnapshot["send"]["sendTransaction"]>) => (await whenReady()).send.sendTransaction(...args)) as PrivyBridgeSnapshot["send"]["sendTransaction"];
const createWallet = (async (...args: Parameters<PrivyBridgeSnapshot["createWallet"]["createWallet"]>) => (await whenReady()).createWallet.createWallet(...args)) as PrivyBridgeSnapshot["createWallet"]["createWallet"];
const login = ((...args: Parameters<PrivyBridgeSnapshot["login"]["login"]>) => { void whenReady().then((s) => s.login.login(...args)); }) as PrivyBridgeSnapshot["login"]["login"];
const initOAuth = (async (...args: Parameters<PrivyBridgeSnapshot["oauth"]["initOAuth"]>) => (await whenReady()).oauth.initOAuth(...args)) as PrivyBridgeSnapshot["oauth"]["initOAuth"];
const sendCode = (async (...args: Parameters<PrivyBridgeSnapshot["email"]["sendCode"]>) => (await whenReady()).email.sendCode(...args)) as PrivyBridgeSnapshot["email"]["sendCode"];
const loginWithCode = (async (...args: Parameters<PrivyBridgeSnapshot["email"]["loginWithCode"]>) => (await whenReady()).email.loginWithCode(...args)) as PrivyBridgeSnapshot["email"]["loginWithCode"];
const linkWith = (name: "linkTwitter" | "linkDiscord" | "linkGithub" | "linkWallet") => ((...args: unknown[]) => { void whenReady().then((s) => (s.link[name] as (...a: unknown[]) => void)(...args)); });
const linkTwitter = linkWith("linkTwitter") as PrivyBridgeSnapshot["link"]["linkTwitter"];
const linkDiscord = linkWith("linkDiscord") as PrivyBridgeSnapshot["link"]["linkDiscord"];
const linkGithub = linkWith("linkGithub") as PrivyBridgeSnapshot["link"]["linkGithub"];
const linkWallet = linkWith("linkWallet") as PrivyBridgeSnapshot["link"]["linkWallet"];
const unlinkOAuth = (async (...args: Parameters<PrivyBridgeSnapshot["unlinkOAuth"]["unlink"]>) => (await whenReady()).unlinkOAuth.unlink(...args)) as PrivyBridgeSnapshot["unlinkOAuth"]["unlink"];
const unlinkWallet = (async (...args: Parameters<PrivyBridgeSnapshot["unlinkWallet"]["unlink"]>) => (await whenReady()).unlinkWallet.unlink(...args)) as PrivyBridgeSnapshot["unlinkWallet"]["unlink"];

const idleState = { status: "initial" } as const;
const noWallets: PrivyBridgeSnapshot["wallets"]["wallets"] = [];

export function usePrivy() {
  const ready = useBridge((s) => s.privy.ready, false);
  const authenticated = useBridge((s) => s.privy.authenticated, false);
  const user = useBridge((s) => s.privy.user, null);
  return { ready, authenticated, user, getAccessToken, logout };
}
export function useUser() {
  const user = useBridge((s) => s.user.user, null);
  return { user, refreshUser };
}
export function useWallets() {
  const wallets = useBridge((s) => s.wallets.wallets, noWallets);
  const ready = useBridge((s) => s.wallets.ready, false);
  return { wallets, ready };
}
export function useSendTransaction() { return { sendTransaction }; }
export function useCreateWallet() { return { createWallet }; }
export function useLogin(options?: LoginCallbacks) {
  useCallbacks("login", options as AnyCallbacks | undefined);
  return { login };
}
export function useLoginWithOAuth(options?: OAuthCallbacks) {
  useCallbacks("oauth", options as AnyCallbacks | undefined);
  const state = useBridge((s) => s.oauth.state, idleState as PrivyBridgeSnapshot["oauth"]["state"]);
  return { initOAuth, state };
}
export function useLoginWithEmail(options?: EmailCallbacks) {
  useCallbacks("email", options as AnyCallbacks | undefined);
  const state = useBridge((s) => s.email.state, idleState as PrivyBridgeSnapshot["email"]["state"]);
  return { sendCode, loginWithCode, state };
}
export function useLinkAccount(options?: LinkCallbacks) {
  useCallbacks("link", options as AnyCallbacks | undefined);
  return { linkTwitter, linkDiscord, linkGithub, linkWallet };
}
export function useUnlinkOAuth() { return { unlink: unlinkOAuth }; }
export function useUnlinkWallet() { return { unlink: unlinkWallet }; }

/** Test helper: forget the loaded SDK. */
export function resetPrivyBridgeForTests() { snapshot = null; requested = false; listeners.clear(); readyWaiters.clear(); }
