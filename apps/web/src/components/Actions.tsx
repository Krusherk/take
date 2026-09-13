import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  full?: boolean;
  arrow?: "right" | "up" | "back" | "none";
}

function ActionArrow({ direction }: { direction: NonNullable<ActionProps["arrow"]> }) {
  if (direction === "none") {
    return null;
  }
  if (direction === "up") {
    return <ArrowUpRight aria-hidden="true" size={17} strokeWidth={1.8} />;
  }
  if (direction === "back") {
    return <ArrowLeft aria-hidden="true" size={17} strokeWidth={1.8} />;
  }
  return <ArrowRight aria-hidden="true" size={17} strokeWidth={1.8} />;
}

export function PrimaryAction({ children, full = false, arrow = "right", className = "", ...props }: ActionProps) {
  return (
    <button className={`action action--primary${full ? " action--full" : ""} ${className}`} {...props}>
      <span className="action__label">{children}</span>
      <span className="action__end" aria-hidden="true">
        <ActionArrow direction={arrow} />
      </span>
    </button>
  );
}

export function SecondaryAction({ children, full = false, arrow = "none", className = "", ...props }: ActionProps) {
  return (
    <button className={`action action--secondary${full ? " action--full" : ""} ${className}`} {...props}>
      <span className="action__label">{children}</span>
      {arrow !== "none" ? (
        <span className="action__end" aria-hidden="true">
          <ActionArrow direction={arrow} />
        </span>
      ) : null}
    </button>
  );
}

export function TextAction({ children, arrow = "right", className = "", ...props }: ActionProps) {
  return (
    <button className={`text-action ${className}`} {...props}>
      <span>{children}</span>
      <ActionArrow direction={arrow} />
    </button>
  );
}
