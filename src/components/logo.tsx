/** Two overlapping rings: the filled overlap is the access that's shared. */
export function LogoMark({ size = 24, className, ink = "#161616", accent = "#1f6f43" }: { size?: number; className?: string; ink?: string; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="12" cy="16" r="7" fill="none" stroke={ink} strokeWidth="2.5" />
      <circle cx="20" cy="16" r="7" fill="none" stroke={accent} strokeWidth="2.5" />
      <path d="M16 10.26A7 7 0 0 1 16 21.74A7 7 0 0 1 16 10.26Z" fill={accent} />
    </svg>
  );
}
