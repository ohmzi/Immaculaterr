import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'text-sm font-medium transition-all duration-200',
    'ring-offset-background outline-none',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default: [
          'rounded-full bg-primary text-primary-foreground',
          'shadow-lg shadow-primary/20',
          'hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/25',
          'hover:-translate-y-0.5',
          'active:translate-y-0 active:scale-[0.98]',
        ].join(' '),
        destructive: [
          'rounded-full bg-destructive text-destructive-foreground',
          'shadow-lg shadow-destructive/20',
          'hover:bg-destructive/90 hover:shadow-xl',
          'hover:-translate-y-0.5',
          'active:translate-y-0 active:scale-[0.98]',
        ].join(' '),
        outline: [
          'rounded-full border-2 border-border bg-background',
          'hover:border-primary/40 hover:bg-accent',
          'hover:-translate-y-0.5',
          'active:translate-y-0 active:scale-[0.98]',
        ].join(' '),
        secondary: [
          'rounded-full bg-secondary text-secondary-foreground',
          'hover:bg-secondary/80',
          'hover:-translate-y-0.5',
          'active:translate-y-0 active:scale-[0.98]',
        ].join(' '),
        ghost: [
          'rounded-lg',
          'hover:bg-accent hover:text-accent-foreground',
        ].join(' '),
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-8 px-4 text-sm',
        lg: 'h-12 px-8 text-base',
        xl: 'h-14 px-10 text-lg',
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
