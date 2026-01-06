// Shared Tailwind class strings for consistent UX across pages.
// Keep this file export-only (no React components) to preserve fast refresh behavior.

export const APP_BG_IMAGE_URL =
  "https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral";

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

// Status pill placement:
// - Mobile: tiny, pinned top-left of the card
// - Desktop: inline next to the card title
export const APP_HEADER_STATUS_PILL_BASE_CLASS =
  'absolute left-6 top-2 z-30 inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[9px] font-semibold sm:static sm:px-3 sm:py-1 sm:text-xs';

