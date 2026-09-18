import React, { type ButtonHTMLAttributes, type ReactNode, type ComponentType } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ComponentType<any> | ReactNode;
  children: ReactNode;
}

const variants = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500/30 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300 focus-visible:ring-slate-500/20 shadow-sm',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/30 shadow-sm',
  ghost: 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:ring-slate-500/20',
  success: 'bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500/30 shadow-sm',
};

const sizes = {
  xs: 'text-xs px-2.5 py-1.5 gap-1.5 rounded-lg',
  sm: 'text-sm px-3 py-2 gap-2 rounded-lg',
  md: 'text-sm px-4 py-2.5 gap-2 rounded-xl',
  lg: 'text-base px-5 py-3 gap-2.5 rounded-xl',
};

export default function Button({ variant = 'primary', size = 'md', loading, icon, children, disabled, className = '', ...props }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : icon ? (
        <span className="shrink-0">{React.isValidElement(icon) ? icon : React.createElement(icon as ComponentType<any>, { className: 'w-4 h-4' })}</span>
      ) : null}
      {children}
    </button>
  );
}
