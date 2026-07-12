/**
 * Per-route colour tints, painted by the AppShell above the shared backdrop.
 *
 * The tint swaps INSTANTLY on navigation (it is not part of the content
 * cross-fade): blending two translucent tints mid-transition is what caused
 * colour flashes — most visibly the dashboard's bright yellow bleeding into
 * dark pages. A one-frame swap reads as "the page changed", not a flash.
 */
const ROUTE_TINTS: Array<[prefix: string, tint: string]> = [
  ['/observatory', 'bg-gradient-to-br from-yellow-300/16 via-purple-800/60 to-purple-950/85'],
  ['/task-manager', 'bg-gradient-to-br from-indigo-900/55 via-blue-900/65 to-slate-900/75'],
  ['/rewind', 'bg-gradient-to-br from-fuchsia-400/35 via-violet-700/45 to-indigo-900/65'],
  ['/history', 'bg-gradient-to-br from-fuchsia-400/35 via-violet-700/45 to-indigo-900/65'],
  ['/logs', 'bg-gradient-to-br from-cyan-400/30 via-sky-700/40 to-indigo-900/65'],
  ['/cutting-room', 'bg-gradient-to-br from-amber-400/25 via-red-900/45 to-zinc-950/70'],
  ['/vault', 'bg-gradient-to-br from-[#2e1065]/50 via-[#1e1b4b]/60 to-[#0f172a]/70'],
  ['/command-center', 'bg-gradient-to-br from-sky-900/55 via-cyan-900/60 to-slate-900/75'],
  ['/faq', 'bg-gradient-to-br from-sky-400/30 via-indigo-700/45 to-slate-950/70'],
  ['/setup', 'bg-gradient-to-br from-sky-400/30 via-indigo-700/45 to-slate-950/70'],
  ['/version-history', 'bg-gradient-to-br from-amber-300/25 via-yellow-700/35 to-slate-950/75'],
  ['/profile', 'bg-gradient-to-br from-[#2e1065]/50 via-[#1e1b4b]/60 to-[#0f172a]/70'],
  ['/__debug', 'bg-gradient-to-br from-[#2e1065]/50 via-[#1e1b4b]/60 to-[#0f172a]/70'],
];

const HOME_TINT =
  'bg-gradient-to-br from-yellow-400/90 via-yellow-300/85 to-green-400/90';
// Unmatched routes render the 404 page, which owns the red treatment.
const FALLBACK_TINT =
  'bg-gradient-to-br from-red-600/85 via-rose-500/80 to-orange-400/75';

export function tintClassForPath(pathname: string): string {
  if (pathname === '/' || pathname === '' || pathname === '/app') {
    return HOME_TINT;
  }
  for (const [prefix, tint] of ROUTE_TINTS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return tint;
  }
  return FALLBACK_TINT;
}
