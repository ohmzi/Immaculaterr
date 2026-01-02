import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Settings2, PlugZap, ListChecks, Layers, FileDown, ScrollText } from 'lucide-react';

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/setup', label: 'Setup', icon: Settings2 },
      { to: '/connections', label: 'Connections', icon: PlugZap },
      { to: '/collections', label: 'Collections', icon: Layers },
      { to: '/import', label: 'Import', icon: FileDown },
    ],
  },
  {
    label: 'Automation',
    items: [
      { to: '/jobs', label: 'Jobs', icon: ListChecks },
      { to: '/runs', label: 'Runs', icon: ScrollText },
    ],
  },
];

export const navItems: NavItem[] = navSections.flatMap((s) => s.items);


