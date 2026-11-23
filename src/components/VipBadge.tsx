import React from 'react';

interface VipBadgeProps {
  className?: string;
}

export const VipBadge: React.FC<VipBadgeProps> = ({ className = '' }) => {
  return (
    <span
      className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-amber-400/20 border border-amber-400/70 text-[10px] font-black text-amber-300 uppercase tracking-wider shrink-0 shadow-[0_0_10px_rgba(251,191,36,0.22)] ${className}`}
      title="VIP Member"
      aria-label="VIP"
    >
      <span aria-hidden="true" className="leading-none">
        👑
      </span>
      <span>VIP</span>
    </span>
  );
};
