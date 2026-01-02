import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-xl text-sm font-semibold',
    'ring-offset-background transition-all duration-200 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'bg-primary text-primary-foreground',
          'shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30',
          'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
          'hover:bg-primary/90',
        ].join(' '),
        destructive: [
          'bg-destructive text-destructive-foreground',
          'shadow-lg shadow-destructive/25 hover:shadow-xl hover:shadow-destructive/30',
          'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
          'hover:bg-destructive/90',
        ].join(' '),
        outline: [
          'border-2 border-border bg-background/60 backdrop-blur-sm',
          'hover:bg-accent hover:text-accent-foreground hover:border-accent',
          'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
          'shadow-sm hover:shadow-md',
        ].join(' '),
        secondary: [
          'bg-secondary text-secondary-foreground',
          'shadow-sm hover:shadow-md',
          'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]',
          'hover:bg-secondary/80',
        ].join(' '),
        ghost: [
          'hover:bg-accent hover:text-accent-foreground',
          'hover:-translate-y-0.5 active:translate-y-0',
        ].join(' '),
        link: 'text-primary underline-offset-4 hover:underline',
        // New: Floating style like CoLabs
        floating: [
          'bg-card text-card-foreground border-2 border-border',
          'shadow-lg hover:shadow-2xl',
          'hover:-translate-y-1 hover:border-primary/30',
          'active:translate-y-0 active:scale-[0.98]',
        ].join(' '),
      },
      size: {
        default: 'h-11 px-5 py-2.5',
        sm: 'h-9 rounded-lg px-3.5 text-xs',
        lg: 'h-12 rounded-xl px-8 text-base',
        xl: 'h-14 rounded-2xl px-10 text-lg',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
