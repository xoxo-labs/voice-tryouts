import { cn } from "@/lib/utils";

/**
 * Instrument-panel section marker: a small uppercase mono label with air
 * around it. This is how sections separate in this UI — typography and space,
 * not boxes.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase",
        className,
      )}
    >
      {children}
    </h3>
  );
}

/** One-line explanation under a SectionLabel. */
export function SectionNote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-muted-foreground text-sm leading-6", className)}>
      {children}
    </p>
  );
}
