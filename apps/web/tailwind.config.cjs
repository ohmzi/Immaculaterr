/**
 * NOTE: this file is INERT. The project runs Tailwind v4, which only reads a JS
 * config when a stylesheet pulls it in with `@config` — nothing does. Adding a
 * token here will silently never reach the output CSS; that is how the hero
 * chart's shimmer, `font-plex`/`font-tesla` and the accordion keyframes all
 * ended up as no-op class names. Put new theme tokens in `src/theme.css`
 * (`@theme`) instead.
 *
 * What is left below is duplicated by `src/theme.css` (colors, borderRadius,
 * dark variant) or by `@source` in `src/tailwind.css` (content), so nothing is
 * lost by it not being read. It is kept only as a reference for the v3 setup.
 *
 * The `tailwindcss-animate` plugin that used to be listed here was dead for the
 * same reason; `tw-animate-css` replaces it and is imported from
 * `src/tailwind.css`.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
};