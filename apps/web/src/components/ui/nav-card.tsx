import * as React from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NavCardProps {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'info';
  className?: string;
  delay?: number;
}

const badgeStyles = {
  default: 'bg-muted text-muted-foreground',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
};

export const NavCard = React.forwardRef<HTMLAnchorElement, NavCardProps>(
  ({ to, icon: Icon, title, description, badge, badgeVariant = 'default', className, delay = 0 }, ref) => {
    return (
      <Link
        ref={ref}
        to={to}
        className={cn(
          'group relative block rounded-2xl border bg-card p-6 float-card',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'animate-fade-in-up',
          className,
        )}
        style={{ animationDelay: `${delay}ms` }}
      >
        {/* Gradient overlay on hover */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        
        <div className="relative">
          {/* Icon */}
          <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary icon-float">
            <Icon className="h-6 w-6" />
          </div>

          {/* Badge */}
          {badge && (
            <span
              className={cn(
                'absolute right-0 top-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
                badgeStyles[badgeVariant],
              )}
            >
              {badge}
            </span>
          )}

          {/* Title */}
          <h3 className="mb-2 text-lg font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
            {title}
          </h3>

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            {description}
          </p>

          {/* Arrow indicator */}
          <div className="mt-4 flex items-center text-sm font-medium text-primary opacity-0 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1">
            <span>Explore</span>
            <svg
              className="ml-1 h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </Link>
    );
  },
);

NavCard.displayName = 'NavCard';

export interface NavCardGridProps {
  children: React.ReactNode;
  className?: string;
}

export function NavCardGrid({ children, className }: NavCardGridProps) {
  return (
    <div
      className={cn(
        'grid gap-4 sm:gap-6',
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

