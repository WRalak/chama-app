export function BrandMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="#14532D" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" strokeWidth="2.2" />
      <circle cx="16" cy="7.5" r="2.6" fill="#16A34A" stroke="#14532D" strokeWidth="1.2" />
      <circle cx="23.4" cy="20.3" r="2.6" fill="#fff" />
      <circle cx="8.6" cy="20.3" r="2.6" fill="#fff" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-2">
      <BrandMark />
      <div className="leading-tight">
        <p className="text-sm font-semibold text-navy">ChamaHub</p>
        <p className="text-2xs text-muted">Administration</p>
      </div>
    </div>
  );
}
