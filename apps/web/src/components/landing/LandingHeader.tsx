import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface LandingHeaderProps {
  onSignIn: () => void;
}

const links = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#use-cases", label: "Use cases" },
  { href: "#why-take", label: "Why TAKE" },
  { href: "#about", label: "About" },
];

export function LandingHeader({ onSignIn }: LandingHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="landing-header">
      <a className="landing-brand" href="#top" aria-label="TAKE home">
        TAKE<span aria-hidden="true">.</span>
      </a>

      <nav className="landing-nav" aria-label="Public navigation">
        {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
      </nav>

      <button className="landing-sign-in" type="button" onClick={onSignIn}>
        Sign in
      </button>

      <button
        ref={menuButtonRef}
        className="landing-menu-toggle"
        type="button"
        aria-label={menuOpen ? "Close navigation" : "Open navigation"}
        aria-expanded={menuOpen}
        aria-controls="landing-mobile-nav"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
      </button>

      {menuOpen ? (
        <div className="landing-mobile-layer" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}>
          <nav id="landing-mobile-nav" className="landing-mobile-nav" aria-label="Mobile navigation">
            {links.map((link) => <a key={link.href} href={link.href} onClick={closeMenu}>{link.label}</a>)}
            <button type="button" onClick={() => { closeMenu(); onSignIn(); }}>Sign in</button>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
