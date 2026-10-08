import type { TakePath } from "../hooks/usePathRouter";

interface BrandProps {
  navigate?: (path: TakePath) => void;
  compact?: boolean;
  light?: boolean;
}

const LOGO = { src: "/assets/sticker/logo.webp", width: 243, height: 240 };

/** The TAKE logo: a die-cut star sticker. Screen readers hear "TAKE". */
function Logo() {
  return <img className="brand__logo" src={LOGO.src} alt="TAKE" width={LOGO.width} height={LOGO.height} decoding="async" draggable={false} />;
}

export function Brand({ navigate, compact = false, light = false }: BrandProps) {
  const className = `brand brand--logo${compact ? " brand--compact" : ""}${light ? " brand--light" : ""}`;

  if (!navigate) {
    return (
      <span className={className}>
        <Logo />
      </span>
    );
  }

  return (
    <a
      className={className}
      href="/home"
      aria-label="TAKE home"
      onClick={(event) => {
        event.preventDefault();
        navigate("/home");
      }}
    >
      <Logo />
    </a>
  );
}
