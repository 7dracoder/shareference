/** Two overlapping rings: the filled overlap is the access that's shared. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <circle cx="12" cy="16" r="7" fill="none" stroke="#f1f5f2" strokeWidth="2.5" />
      <circle cx="20" cy="16" r="7" fill="none" stroke="#b6e6c7" strokeWidth="2.5" />
      <path d="M16 10.26A7 7 0 0 1 16 21.74A7 7 0 0 1 16 10.26Z" fill="#b6e6c7" />
    </svg>
  );
}
