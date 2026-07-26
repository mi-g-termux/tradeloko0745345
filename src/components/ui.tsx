"use client";
// Shared UI primitives — the single source of truth for every button, chip,
// filter, toggle and modal in the app.
//
// The old admin panel used bare <button> elements whose on/off state was only a
// colour change, which is exactly why nobody could tell what was enabled.
// The Switch here always renders the literal word ON or OFF plus a knob
// position, so state is readable without knowing the colour language.
import React from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ─────────────────────────── Button ─────────────────────────── */

type ButtonVariant = "primary" | "ghost" | "outline" | "danger" | "success";
type ButtonSize = "xs" | "sm" | "md";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:brightness-110",
  ghost: "bg-panel2 text-mute hover:text-ink",
  outline: "border border-edge2 bg-transparent text-mute hover:text-ink",
  danger: "bg-down text-white hover:brightness-110",
  success: "bg-up text-black hover:brightness-110",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-2xs",
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function Button({
  variant = "ghost",
  size = "sm",
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-40",
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ─────────────────────────── Chip ─────────────────────────── */

/** Pill used for categories, quick filters and the market ticker strip. */
export function Chip({
  active,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-accent bg-accent/15 text-ink"
          : "border-edge bg-panel text-mute hover:border-edge2 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ────────────────────── Segmented control ────────────────────── */

/** DexScreener's 5M / 1H / 6H / 24H style selector. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
  className,
}: {
  options: Array<{ value: T; label: string; title?: string }>;
  value: T;
  onChange: (v: T) => void;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx(
        "inline-flex items-center gap-0.5 rounded-md border border-edge bg-panel p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded font-medium transition",
            size === "xs" ? "px-2 py-0.5 text-2xs" : "px-2.5 py-1 text-xs",
            value === o.value
              ? "bg-panel2 text-ink shadow-glow"
              : "text-mute hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────── Switch ─────────────────────────── */

/**
 * Toggle with an explicit ON / OFF word.
 *
 * Colour alone is not enough: it is invisible to colour-blind admins and
 * ambiguous on a dark theme. The label, knob position and border all change.
 */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  status,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  /** Optional right-hand badge, e.g. "needs key". */
  status?: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex items-start justify-between gap-4 rounded-md border p-3 transition",
        checked ? "border-up/40 bg-up/5" : "border-edge bg-panel2/40",
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{label}</span>
          {status}
        </div>
        {hint ? (
          <p className="mt-1 text-2xs leading-relaxed text-mute">{hint}</p>
        ) : null}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${label} is ${checked ? "on" : "off"}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative flex h-7 w-[76px] shrink-0 items-center rounded-full border px-1 transition",
          "disabled:cursor-not-allowed disabled:opacity-40",
          checked ? "border-up bg-up/20" : "border-edge2 bg-panel",
        )}
      >
        {/* The word is what makes the state unambiguous. */}
        <span
          className={cx(
            "w-full text-center text-2xs font-bold tracking-wider",
            checked ? "pr-5 text-up" : "pl-5 text-faint",
          )}
        >
          {checked ? "ON" : "OFF"}
        </span>
        <span
          className={cx(
            "absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all",
            checked ? "left-[52px] bg-up" : "left-1 bg-faint",
          )}
        />
      </button>
    </div>
  );
}

/* ─────────────────────────── Badges ─────────────────────────── */

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: "neutral" | "up" | "down" | "warn" | "accent";
  children: React.ReactNode;
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-edge2 bg-panel2 text-mute",
    up: "border-up/40 bg-up/10 text-up",
    down: "border-down/40 bg-down/10 text-down",
    warn: "border-warn/40 bg-warn/10 text-warn",
    accent: "border-accent/40 bg-accent/10 text-accent",
  };
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Feature status badge shared by the admin panel and /features. */
export function StatusBadge({ state }: { state: string }) {
  if (state === "live") return <Badge tone="up">live</Badge>;
  if (state === "needs_key") return <Badge tone="warn">needs key</Badge>;
  return <Badge tone="neutral">off</Badge>;
}

/* ─────────────────────────── Stat tile ─────────────────────────── */

export function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("card px-3 py-2", className)}>
      <div className="text-2xs uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink">{value}</div>
      {sub ? <div className="text-2xs text-mute">{sub}</div> : null}
    </div>
  );
}

/* ─────────────────────────── Fields ─────────────────────────── */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-mute">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-2xs text-faint">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-edge bg-base px-2.5 py-2 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none";

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  const { className, ...rest } = props;
  return <input {...rest} className={cx(inputClass, className)} />;
}

/* ─────────────────────────── Modal ─────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  // Close on Escape — expected behaviour for a filter dialog.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center">
      <div
        className={cx(
          "card w-full shadow-pop",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <Button size="xs" variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ─────────────────────────── Tabs ─────────────────────────── */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="scroll-x flex items-center gap-1 border-b border-edge">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={cx(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition",
            value === t.value
              ? "border-accent text-ink"
              : "border-transparent text-mute hover:text-ink",
          )}
        >
          {t.label}
          {t.count != null ? (
            <span className="ml-1.5 text-faint">{t.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────── Sortable table header ─────────────────────── */

export function SortTh<T extends string>({
  col,
  label,
  sort,
  dir,
  onSort,
  align = "right",
  title,
  className,
}: {
  col: T;
  label: string;
  sort: T;
  dir: "asc" | "desc";
  onSort: (c: T) => void;
  align?: "left" | "right";
  title?: string;
  /** Responsive visibility, e.g. "hidden md:table-cell" to drop it on phones. */
  className?: string;
}) {
  const active = sort === col;
  return (
    <th
      title={title}
      onClick={() => onSort(col)}
      className={cx(
        "th-sort",
        align === "right" && "text-right",
        active && "text-ink",
        className,
      )}
    >
      {label}
      <span className={cx("ml-1", active ? "text-accent" : "text-transparent")}>
        {active && dir === "asc" ? "▲" : "▼"}
      </span>
    </th>
  );
}

/* ─────────────────────────── Misc ─────────────────────────── */

/**
 * Two-sided proportion bar (buys vs sells, traders in vs out, and so on).
 *
 * Accepts either the generic `left`/`right` pair with custom captions, or the
 * original `buys`/`sells` pair which auto-captions itself. Both shapes are
 * supported so existing call sites keep working.
 */
export function SplitBar({
  label,
  left,
  right,
  leftLabel,
  rightLabel,
  buys,
  sells,
}: {
  label: string;
  left?: number;
  right?: number;
  leftLabel?: string;
  rightLabel?: string;
  buys?: number;
  sells?: number;
}) {
  const leftValue = left ?? buys ?? 0;
  const rightValue = right ?? sells ?? 0;
  const total = leftValue + rightValue;
  // With no activity at all, show an even split rather than a full green bar.
  const leftPct = total > 0 ? (leftValue / total) * 100 : 50;

  const leftText = leftLabel ?? "buys " + leftValue.toLocaleString();
  const rightText = rightLabel ?? "sells " + rightValue.toLocaleString();

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-2xs text-mute">
        <span className="truncate">{label}</span>
        <span className="shrink-0 whitespace-nowrap">
          <span className="text-up">{leftText}</span>
          <span className="px-1 text-faint">/</span>
          <span className="text-down">{rightText}</span>
        </span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-panel2">
        <div className="bg-up" style={{ width: `${leftPct}%` }} />
        <div className="bg-down" style={{ width: `${100 - leftPct}%` }} />
      </div>
    </div>
  );
}

export { cx };
