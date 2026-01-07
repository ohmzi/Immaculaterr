// Shared Tailwind class strings for consistent UX across pages.
// Keep this file export-only (no React components) to preserve fast refresh behavior.

import appBgUrl from '../assets/app-bg.png';

export const APP_BG_IMAGE_URL = appBgUrl;

// Bright top-left highlight (uniform across pages).
export const APP_BG_HIGHLIGHT_CLASS =
  'bg-gradient-to-br from-[#facc15]/20 via-transparent to-transparent';

// Soft dark wash to keep text readable over the background image.
export const APP_BG_DARK_WASH_CLASS = 'bg-[#0b0c0f]/15';

// Primary “press” animation for buttons/links.
export const APP_PRESSABLE_CLASS =
  'touch-manipulation transition-all duration-200 active:scale-95';

// Standard interactive card surface (hover + press darken + glow).
export const APP_CARD_INTERACTIVE_CLASS =
  "group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-purple-500/10 focus-within:border-white/15 focus-within:shadow-purple-500/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-purple-500/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10";

// Smaller list-item card (used for “row cards” like Rewind history on mobile).
export const APP_CARD_ROW_CLASS =
  'group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur transition-all duration-200 hover:bg-white/10 active:bg-white/10 active:scale-[0.99]';

// Icon glow inside a `group` card.
export const APP_CARD_ICON_GLOW_CLASS =
  'transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]';

export const APP_HEADER_STATUS_PILL_BASE_CLASS =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold whitespace-nowrap shrink-0';

