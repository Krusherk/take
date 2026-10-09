import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from "react";
import "./organize-ui.css";

/**
 * iOS-style wheel for a local date and time. The value stays the same
 * "YYYY-MM-DDTHH:mm" string the form already used with datetime-local.
 *
 * Each column is a spinbutton for keyboards and screen readers; the scrolling
 * list inside it is visual (scroll-snap, mouse wheel, touch).
 */

const ITEM_HEIGHT = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

export type WheelDateTimePickerProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Days listed, starting today. */
  days?: number;
  minuteStep?: number;
  error?: string;
  hint?: string;
  /** For tests and stories. */
  now?: Date;
  hour12?: boolean;
};

type Option = { key: string; label: string; aria: string };

export function WheelDateTimePicker({
  label, value, onChange, days = 366, minuteStep = 5, error, hint, now, hour12,
}: WheelDateTimePickerProps) {
  const id = useId();
  const parsed = parseLocal(value) ?? roundTo(new Date((now ?? new Date()).getTime() + 60 * 60 * 1000), minuteStep);
  const uses12h = hour12 ?? prefers12Hour();
  const today = startOfDay(now ?? new Date());

  const dayOptions = useMemo(() => {
    const list: Date[] = [];
    const selectedDay = startOfDay(parsed);
    if (selectedDay < today) list.push(selectedDay);
    for (let index = 0; index < days; index += 1) list.push(addDays(today, index));
    if (selectedDay > list[list.length - 1]!) list.push(selectedDay);
    return list;
  }, [today.getTime(), days, startOfDay(parsed).getTime()]);

  const dayIndex = Math.max(0, dayOptions.findIndex((day) => sameDay(day, parsed)));
  const hours24 = parsed.getHours();
  const minuteIndex = Math.min(Math.round(parsed.getMinutes() / minuteStep), Math.floor(59 / minuteStep));
  const isPm = hours24 >= 12;
  const hourIndex = uses12h ? hours24 % 12 : hours24;

  const dayItems: Option[] = dayOptions.map((day) => ({ key: day.toISOString(), label: dayLabel(day, today), aria: longDay(day) }));
  const hourItems: Option[] = Array.from({ length: uses12h ? 12 : 24 }, (_, index) => {
    const shown = uses12h ? (index === 0 ? 12 : index) : index;
    const text = uses12h ? String(shown) : String(shown).padStart(2, "0");
    return { key: String(index), label: text, aria: text };
  });
  const minuteItems: Option[] = Array.from({ length: Math.floor(59 / minuteStep) + 1 }, (_, index) => {
    const text = String(index * minuteStep).padStart(2, "0");
    return { key: text, label: text, aria: text };
  });
  const periodItems: Option[] = [{ key: "AM", label: "AM", aria: "AM" }, { key: "PM", label: "PM", aria: "PM" }];

  function emit(next: { day?: number; hour?: number; minute?: number; pm?: boolean }) {
    const day = dayOptions[next.day ?? dayIndex] ?? dayOptions[dayIndex]!;
    const pm = next.pm ?? isPm;
    const hourValue = next.hour ?? hourIndex;
    const hour = uses12h ? (hourValue % 12) + (pm ? 12 : 0) : hourValue;
    const minute = (next.minute ?? minuteIndex) * minuteStep;
    const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
    const text = toLocal(date);
    if (text !== value) onChange(text);
  }

  const zone = timeZoneLabel(parsed);
  const describedBy = `${id}-summary${error ? ` ${id}-error` : ""}`;
  return (
    <fieldset className={`wheel-picker${error ? " has-error" : ""}`} aria-describedby={describedBy}>
      <legend className="wheel-picker__legend">
        <span>{label}</span>
        <small className="wheel-picker__zone" title={Intl.DateTimeFormat().resolvedOptions().timeZone}>{zone}</small>
      </legend>
      <div className="wheel-picker__wheels">
        <span className="wheel-picker__band" aria-hidden="true" />
        <WheelColumn name={`${label}, day`} className="wheel-col--day" items={dayItems} index={dayIndex} onIndex={(day) => emit({ day })} />
        <WheelColumn name={`${label}, hour`} className="wheel-col--hour" items={hourItems} index={hourIndex} onIndex={(hour) => emit({ hour })} wrap />
        <span className="wheel-picker__colon" aria-hidden="true">:</span>
        <WheelColumn name={`${label}, minute`} className="wheel-col--minute" items={minuteItems} index={minuteIndex} onIndex={(minute) => emit({ minute })} wrap />
        {uses12h ? <WheelColumn name={`${label}, AM or PM`} className="wheel-col--period" items={periodItems} index={isPm ? 1 : 0} onIndex={(period) => emit({ pm: period === 1 })} /> : null}
      </div>
      <p className="wheel-picker__summary" id={`${id}-summary`}>{summary(parsed, now ?? new Date(), zone, uses12h)}</p>
      {hint && !error ? <p className="wheel-picker__hint">{hint}</p> : null}
      {error ? <p className="wheel-picker__error" id={`${id}-error`} role="alert">{error}</p> : null}
    </fieldset>
  );
}

function WheelColumn({ name, items, index, onIndex, className, wrap = false }: {
  name: string;
  items: Option[];
  index: number;
  onIndex: (index: number) => void;
  className?: string;
  wrap?: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const settle = useRef<number>(0);
  const programmatic = useRef(false);
  const latest = useRef({ index, onIndex });
  latest.current = { index, onIndex };

  // Keep the wheel on the selected row when the value changes from outside.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const target = index * ITEM_HEIGHT;
    if (Math.abs(node.scrollTop - target) < 2) return;
    programmatic.current = true;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof node.scrollTo === "function") node.scrollTo({ top: target, behavior: reduce || !node.dataset.ready ? "auto" : "smooth" });
    else node.scrollTop = target;
    node.dataset.ready = "1";
    window.setTimeout(() => { programmatic.current = false; }, 400);
  }, [index]);

  useEffect(() => () => window.clearTimeout(settle.current), []);

  function onScroll() {
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const node = scroller.current;
      if (!node || programmatic.current) return;
      const next = clamp(Math.round(node.scrollTop / ITEM_HEIGHT), 0, items.length - 1);
      if (next !== latest.current.index) latest.current.onIndex(next);
    }, 110);
  }

  function step(delta: number) {
    let next = index + delta;
    if (wrap) next = (next + items.length) % items.length;
    next = clamp(next, 0, items.length - 1);
    if (next !== index) onIndex(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const page = Math.max(1, Math.round(items.length / 6));
    const moves: Record<string, () => void> = {
      ArrowUp: () => step(1),
      ArrowRight: () => step(1),
      ArrowDown: () => step(-1),
      ArrowLeft: () => step(-1),
      PageUp: () => step(page),
      PageDown: () => step(-page),
      Home: () => onIndex(0),
      End: () => onIndex(items.length - 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    move();
  }

  const current = items[index];
  return (
    <div className={`wheel-col ${className ?? ""}`}>
      <button type="button" className="wheel-col__nudge wheel-col__nudge--up" tabIndex={-1} aria-hidden="true" onClick={() => step(-1)} disabled={!wrap && index === 0}>
        <ChevronUp size={16} />
      </button>
      <div
        className="wheel-col__spin"
        role="spinbutton"
        tabIndex={0}
        aria-label={name}
        aria-valuenow={index}
        aria-valuemin={0}
        aria-valuemax={items.length - 1}
        aria-valuetext={current?.aria}
        onKeyDown={onKeyDown}
      >
        <div className="wheel-col__scroller" ref={scroller} onScroll={onScroll} aria-hidden="true">
          <ul>
            {items.map((item, itemIndex) => (
              <li key={item.key} className={itemIndex === index ? "is-selected" : undefined} onClick={() => onIndex(itemIndex)}>{item.label}</li>
            ))}
          </ul>
        </div>
      </div>
      <button type="button" className="wheel-col__nudge wheel-col__nudge--down" tabIndex={-1} aria-hidden="true" onClick={() => step(1)} disabled={!wrap && index === items.length - 1}>
        <ChevronDown size={16} />
      </button>
    </div>
  );
}

export function parseLocal(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as number[];
  const date = new Date(year!, month! - 1, day!, hour!, minute!);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toLocal(date: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function roundTo(date: Date, minuteStep: number) {
  const stepMs = minuteStep * 60_000;
  return new Date(Math.ceil(date.getTime() / stepMs) * stepMs);
}

/** "WAT · GMT+1" where the browser knows a short name, otherwise "GMT+1". */
export function timeZoneLabel(at = new Date()) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const read = (locale: string | undefined) => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
        .formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? null;
    } catch {
      return null;
    }
  };
  const offset = read("en-GB") ?? "";
  const generic = (name: string | null) => !name || /^(GMT|UTC)/.test(name);
  const locales = [typeof navigator === "undefined" ? undefined : navigator.language, "en-US", "en-NG", "en-ZA", "en-IN", "en-AU", "en-GB"];
  const named = locales.map(read).find((name) => !generic(name));
  if (named && offset && named !== offset) return `${named} · ${offset}`;
  return named ?? (offset || zone);
}

function prefers12Hour() {
  try {
    const cycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
    return cycle === "h12" || cycle === "h11";
  } catch {
    return false;
  }
}

function summary(date: Date, now: Date, zone: string, hour12: boolean) {
  const text = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12 }).format(date);
  return `${text} ${zone.split(" · ")[0]} · ${relative(date.getTime() - now.getTime())}`;
}

function relative(ms: number) {
  if (ms <= 0) return "in the past";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} days`;
}

function dayLabel(day: Date, today: Date) {
  const diff = Math.round((startOfDay(day).getTime() - today.getTime()) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short" }).format(day);
}

function longDay(day: Date) {
  return new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(day);
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
