// Icônes SVG maison — trait 1.5, style Lucide, zéro emoji.
// Tous les éléments décoratifs portent aria-hidden.

interface IconProps {
  className?: string;
  size?: number;
}

function base(size?: number) {
  return {
    width: size ?? 20,
    height: size ?? 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function IconShield({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function IconFingerprint({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 11a3 3 0 013 3c0 2-0.5 4-1.5 5.5" />
      <path d="M12 8a6 6 0 016 6c0 1.2-.1 2.4-.5 3.5" />
      <path d="M4.5 14a7.5 7.5 0 0114.5 0" />
      <path d="M12 2a12 12 0 00-5 2.2" />
      <path d="M5 20.5A12 12 0 0012 22" />
    </svg>
  );
}

export function IconCard({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 9.5h19" />
      <path d="M6 14.5h4" />
    </svg>
  );
}

export function IconCoins({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="9" cy="9" r="5.5" />
      <circle cx="15.5" cy="15.5" r="5.5" />
      <path d="M12.5 6.5a5.5 5.5 0 013 4.5" />
    </svg>
  );
}

export function IconArrowRight({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconArrowLeft({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </svg>
  );
}

export function IconMenu({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

export function IconX({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export function IconLock({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
      <path d="M12 15v2" />
    </svg>
  );
}

export function IconCheck({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12l4.5 4.5L19 7" />
    </svg>
  );
}

export function IconSparkle({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 3l1.8 5.7L19.5 10l-5.7 1.8L12 17.5l-1.8-5.7L4.5 10l5.7-1.3L12 3z" />
    </svg>
  );
}

export function IconPhone({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function IconDiamond({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 4h12l4 5.5L12 20 2 9.5 6 4z" />
      <path d="M2 9.5h20" />
    </svg>
  );
}

export function IconStar({ className, size, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size ?? 14}
      height={size ?? 14}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />
    </svg>
  );
}


export function IconSliders({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 7h10" />
      <path d="M18 7h2" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 17h2" />
      <path d="M10 17h10" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

export function IconSearch({ className, size }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}
