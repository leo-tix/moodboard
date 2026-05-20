import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizes = { sm: "h-3 w-3", md: "h-4 w-4", lg: "h-6 w-6" };

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <div
      className={cn(
        "animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--text-secondary)]",
        sizes[size],
        className
      )}
    />
  );
}
