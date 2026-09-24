import * as React from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------- Surfaces */

export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-xl border border-hair bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-hair px-5 py-4",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-sm font-semibold text-ink", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("mt-1 text-xs text-ink-2", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

/* --------------------------------------------------------------- Buttons */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:brightness-110 disabled:bg-surface-3 disabled:text-muted",
  secondary:
    "border border-hair bg-surface text-ink hover:bg-surface-2 disabled:text-muted",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink disabled:text-muted",
  danger: "border border-hair text-critical hover:bg-surface-2",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3.5 text-sm",
};

export function Button({
  className,
  variant = "secondary",
  size = "md",
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Inputs */

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn("block text-xs font-medium text-ink-2", className)}
      {...props}
    />
  );
}

const FIELD_BASE =
  "w-full rounded-lg border border-hair bg-surface px-3 text-sm text-ink placeholder:text-muted disabled:text-muted";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(FIELD_BASE, "h-9", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(FIELD_BASE, "h-9 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm text-ink", className)}>
      <input
        type="checkbox"
        className="size-4 rounded border-hair accent-[var(--accent)]"
        {...props}
      />
      {label}
    </label>
  );
}

/* --------------------------------------------------------- Segmented tabs */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-hair bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-surface text-ink shadow-[0_1px_2px_var(--hair)]"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- Feedback */

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"span"> & { tone?: "neutral" | "good" | "critical" | "accent" }) {
  const tones = {
    neutral: "border-hair bg-surface-2 text-ink-2",
    good: "border-hair bg-surface-2 text-success-text",
    critical: "border-hair bg-surface-2 text-critical",
    accent: "border-hair bg-surface-2 text-accent",
  } as const;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "error";
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "error" ? AlertTriangle : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-lg border border-hair bg-surface-2 px-4 py-3 text-sm",
        className,
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-critical" : "text-accent")}
        aria-hidden
      />
      <div className="min-w-0">
        {title ? <p className="font-medium text-ink">{title}</p> : null}
        <div className={cn("text-ink-2", title ? "mt-0.5" : "")}>{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-2">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="text-muted">{icon}</div> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <div className="max-w-sm text-xs text-ink-2">{children}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}
