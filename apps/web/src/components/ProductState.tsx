import { ArrowRight, RefreshCw } from "lucide-react";
import { MascotSticker, PaperLabel } from "./sticker/Sticker";

/**
 * Loading, on the sky: a torn paper strip and a bobbing mascot, no boxed card.
 * Shown only when there is nothing cached to draw yet.
 */
export function ProductLoading({ label = "Loading TAKE" }: { label?: string }) {
  const text = /[.…]$/.test(label) ? label : `${label}…`;
  return (
    <section className="take-loader" role="status" aria-live="polite" aria-label={label}>
      <MascotSticker kind="lime" tilt={-6} className="take-loader__mascot" />
      <PaperLabel size="md" tilt={-2} className="take-loader__label">{text}</PaperLabel>
      <span className="take-loader__dots" aria-hidden="true"><i /><i /><i /></span>
    </section>
  );
}

export function ProductError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="take-loader take-loader--error" role="alert">
      <MascotSticker kind="star" tilt={8} className="take-loader__mascot take-loader__mascot--still" />
      <PaperLabel size="sm" tilt={-3} className="take-loader__kicker">couldn’t load TAKE</PaperLabel>
      <PaperLabel size="md" tilt={1.5} className="take-loader__label">{message}</PaperLabel>
      <button className="sticker-pill take-loader__retry" type="button" onClick={onRetry}><RefreshCw size={17} aria-hidden="true" /><span>Try again</span></button>
    </section>
  );
}

export function SocialEmpty({ title, children, action, onAction }: { title: string; children: string; action?: string; onAction?: () => void }) {
  return (
    <div className="social-empty">
      <span className="social-empty__signal" aria-hidden="true"><i /><b /><i /></span>
      <div><strong>{title}</strong><p>{children}</p></div>
      {action && onAction ? <button type="button" onClick={onAction}>{action}<ArrowRight size={17} /></button> : null}
    </div>
  );
}
