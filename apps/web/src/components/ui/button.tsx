import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-semibold transition-all duration-300',
    'ring-offset-background',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'rounded-2xl bg-primary text-primary-foreground',
          'shadow-lg shadow-primary/20',
          'hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/30',
          'active:translate-y-0 active:scale-[0.98]',
        ].join(' '),
        destructive: [
          'rounded-2xl bg-destructive text-destructive-foreground',
          'shadow-lg shadow-destructive/20',
          'hover:-translate-y-1 hover:shadow-xl hover:shadow-destructive/30',
          'active:translate-y-0 active:scale-[0.98]',
        ].join(' '),
        outline: [
          'rounded-2xl border-2 border-border bg-background',
          'hover:border-primary/30 hover:bg-accent hover:-translate-y-1',
          'active:translate-y-0 active:scale-[0.98]',
          'shadow-sm hover:shadow-md',
        ].join(' '),
        secondary: [
          'rounded-2xl bg-secondary text-secondary-foreground',
          'hover:bg-secondary/80 hover:-translate-y-1',
          'active:translate-y-0 active:scale-[0.98]',
          'shadow-sm hover:shadow-md',
        ].join(' '),
        ghost: [
          'rounded-xl',
          'hover:bg-accent hover:text-accent-foreground',
        ].join(' '),
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-12 px-6 text-sm',
        sm: 'h-10 px-4 text-sm rounded-xl',
        lg: 'h-14 px-8 text-base',
        xl: 'h-16 px-10 text-lg',
        icon: 'h-10 w-10',
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
