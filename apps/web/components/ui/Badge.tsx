import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "ai" | "subtle";
  className?: string;
}

const variants = {
  default: "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]",
  ai: "bg-[var(--accent-muted)] text-[var(--accent)] border border-[var(--accent-muted)]",
  subtle: "text-[var(--text-tertiary)]",
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] tracking-wide font-medium",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
