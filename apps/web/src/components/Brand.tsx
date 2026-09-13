import type { TakePath } from "../hooks/usePathRouter";

interface BrandProps {
  navigate?: (path: TakePath) => void;
  compact?: boolean;
  light?: boolean;
}

export function Brand({ navigate, compact = false, light = false }: BrandProps) {
  const className = `brand${compact ? " brand--compact" : ""}${light ? " brand--light" : ""}`;

  if (!navigate) {
    return (
      <span className={className} aria-label="TAKE">
        TAKE<span aria-hidden="true">.</span>
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
      TAKE<span aria-hidden="true">.</span>
    </a>
  );
}
