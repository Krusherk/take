import { AlertTriangle, Check, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./organize-ui.css";

export type ToastTone = "success" | "action" | "error";
export type OrganizeToastMessage = {
  id: number;
  tone: ToastTone;
  title: string;
  body?: ReactNode;
  action?: { label: string; onClick: () => void };
};

const TAGS: Record<ToastTone, string> = { success: "DONE", action: "NEXT STEP", error: "DIDN'T WORK" };
const SUCCESS_MS = 6000;

/**
 * Feedback for the Organize flow, pinned to the bottom of the screen next to
 * the primary action (above the tab bar on phones). Success hides itself;
 * "action needed" and errors stay until dismissed or replaced.
 */
export function OrganizeToast({ toast, onDismiss }: { toast: OrganizeToastMessage | null; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!toast || toast.tone !== "success" || paused) return;
    const timer = window.setTimeout(() => dismiss.current(), SUCCESS_MS);
    return () => window.clearTimeout(timer);
  }, [toast, paused]);

  useEffect(() => {
    if (!toast) return;
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") dismiss.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast]);

  const Icon = toast?.tone === "error" ? ShieldAlert : toast?.tone === "action" ? AlertTriangle : Check;
  return (
    <div className="organize-toast-region">
      {/* Polite region for success and next steps, assertive for errors. Both stay mounted so they announce. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="organize-toast-live">
        {toast && toast.tone !== "error" ? <ToastCard key={toast.id} toast={toast} Icon={Icon} onDismiss={onDismiss} onPause={setPaused} /> : null}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="organize-toast-live">
        {toast && toast.tone === "error" ? <ToastCard key={toast.id} toast={toast} Icon={Icon} onDismiss={onDismiss} onPause={setPaused} /> : null}
      </div>
    </div>
  );
}

function ToastCard({ toast, Icon, onDismiss, onPause }: {
  toast: OrganizeToastMessage;
  Icon: typeof Check;
  onDismiss: () => void;
  onPause: (paused: boolean) => void;
}) {
  return (
    <div
      className={`organize-toast organize-toast--${toast.tone}`}
      onMouseEnter={() => onPause(true)}
      onMouseLeave={() => onPause(false)}
      onFocus={() => onPause(true)}
      onBlur={() => onPause(false)}
    >
      <span className="organize-toast__tag">{TAGS[toast.tone]}</span>
      <span className="organize-toast__icon" aria-hidden="true"><Icon size={18} /></span>
      <div className="organize-toast__text">
        <strong>{toast.title}</strong>
        {toast.body ? <span>{toast.body}</span> : null}
        {toast.action ? <button type="button" className="organize-toast__action" onClick={toast.action.onClick}>{toast.action.label}</button> : null}
      </div>
      <button type="button" className="organize-toast__close" aria-label="Dismiss message" onClick={onDismiss}><X size={16} /></button>
      {toast.tone === "success" ? <span className="organize-toast__timer" aria-hidden="true" /> : null}
    </div>
  );
}
