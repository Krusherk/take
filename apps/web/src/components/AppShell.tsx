import { Activity, Bell, ChevronDown, Compass, Link2, LogOut, Home, PanelsTopLeft, Send, Settings, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Person } from "../types/product";
import type { TakePath } from "../hooks/usePathRouter";
import { Avatar } from "./Avatar";
import { Brand } from "./Brand";

interface AppShellProps {
  path: TakePath;
  navigate: (path: TakePath) => void;
  children: ReactNode;
  unreadCount: number;
  currentPerson: Person;
  onLogout: () => Promise<void>;
}

const desktopItems: Array<{ label: string; path: TakePath }> = [
  { label: "Home", path: "/home" },
  { label: "Explore", path: "/explore" },
  { label: "Activity", path: "/activity" },
  { label: "Your takes", path: "/takes" },
  { label: "Organize", path: "/organize" },
];

const mobileItems: Array<{ label: string; path: TakePath; icon: typeof Home }> = [
  { label: "Home", path: "/home", icon: Home },
  { label: "Explore", path: "/explore", icon: Compass },
  { label: "Takes", path: "/takes", icon: Send },
  { label: "Activity", path: "/activity", icon: Activity },
  { label: "Profile", path: "/profile", icon: UserRound },
];

function NavLink({ label, destination, path, navigate }: { label: string; destination: TakePath; path: TakePath; navigate: (path: TakePath) => void }) {
  const active = path === destination;
  return (
    <a
      className={active ? "is-active" : undefined}
      href={destination}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        navigate(destination);
      }}
    >
      {label}
    </a>
  );
}

export function AppShell({ path, navigate, children, unreadCount, currentPerson, onLogout }: AppShellProps) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;

    function closeOnPointer(event: PointerEvent) {
      if (!accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountOpen(false);
      }
    }

    window.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  function openProfile(section?: "connections" | "account") {
    setAccountOpen(false);
    navigate("/profile");
    if (section) {
      const sectionId = section === "connections" ? "identity-connections" : "profile-account";
      window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" }), 0);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await onLogout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "TAKE could not log you out. Try again.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="app-noise" aria-hidden="true" />
      <header className="app-header">
        <div className="app-header__inner">
          <Brand navigate={navigate} compact />
          <nav className="desktop-nav" aria-label="Primary navigation">
            {desktopItems.map((item) => (
              <NavLink key={item.path} label={item.label} destination={item.path} path={path} navigate={navigate} />
            ))}
          </nav>
          <div className="account-nav" ref={accountRef}>
            <button className={`icon-action${path === "/notifications" ? " is-active" : ""}`} type="button" aria-label="Open notifications" aria-current={path === "/notifications" ? "page" : undefined} onClick={() => navigate("/notifications")}>
              <Bell size={19} strokeWidth={1.7} />
              {unreadCount ? <span className="notification-dot" aria-label={`${unreadCount} unread notifications`} /> : null}
            </button>
            <button
              className="account-chip"
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              aria-label={`Open account menu for ${currentPerson.name}`}
              aria-expanded={accountOpen}
              aria-controls="take-account-menu"
            >
              <Avatar person={currentPerson} size="xs" />
              <span className="account-chip__identity">
                <strong>{currentPerson.name}</strong>
                {currentPerson.handle ? <small>{currentPerson.handle}</small> : null}
              </span>
              <ChevronDown className="account-chip__chevron" size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {accountOpen ? (
              <div className="account-menu" id="take-account-menu" role="menu">
                <div className="account-menu__identity">
                  <Avatar person={currentPerson} size="sm" />
                  <span className="account-menu__copy">
                    <strong>{currentPerson.name}</strong>
                    {currentPerson.handle ? <small>{currentPerson.handle}</small> : <small>TAKE PROFILE</small>}
                  </span>
                </div>
                <div className="account-menu__rule" />
                <button type="button" role="menuitem" onClick={() => openProfile()}>
                  <UserRound size={16} aria-hidden="true" />
                  VIEW PROFILE
                </button>
                <button type="button" role="menuitem" onClick={() => openProfile("connections")}>
                  <Link2 size={16} aria-hidden="true" />
                  MANAGE CONNECTIONS
                </button>
                <button type="button" role="menuitem" onClick={() => openProfile("account")}>
                  <Settings size={16} aria-hidden="true" />
                  ACCOUNT / SETTINGS
                </button>
                <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); navigate("/organize"); }}>
                  <PanelsTopLeft size={16} aria-hidden="true" />
                  ORGANIZE
                </button>
                <div className="account-menu__rule" />
                <button className="account-menu__logout" type="button" role="menuitem" disabled={loggingOut} onClick={() => void handleLogout()}>
                  <LogOut size={16} aria-hidden="true" />
                  {loggingOut ? "LOGGING OUT…" : "LOG OUT"}
                </button>
                {logoutError ? <p role="alert">{logoutError}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = path === item.path;
          return (
            <a
              key={item.path}
              className={active ? "is-active" : undefined}
              href={item.path}
              aria-current={active ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(item.path);
              }}
            >
              <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
    </div>
  );
}
