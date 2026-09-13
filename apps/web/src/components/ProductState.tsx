import { ArrowRight, RefreshCw } from "lucide-react";

export function ProductLoading({ label = "Loading TAKE" }: { label?: string }) {
  return (
    <section className="product-state product-state--loading" aria-live="polite" aria-label={label}>
      <span>{label}</span>
      <i aria-hidden="true" />
    </section>
  );
}

export function ProductError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="product-state product-state--error" role="alert">
      <div><span>COULDN’T LOAD TAKE</span><p>{message}</p></div>
      <button type="button" onClick={onRetry}><RefreshCw size={17} />TRY AGAIN</button>
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
