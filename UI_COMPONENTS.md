# UI Components Reference

## Component Standards
- Base components from shadcn/ui
- Extended via composition, not duplication
- No one-off components without justification
- All components must follow the **Visual Reference** in `design_system.md`

---

## Common Components

### Navigation

#### Desktop (Top Nav)
- Fixed top navigation bar
- Glassmorphic background (`bg-background/80 backdrop-blur-xl`)
- Logo on left, nav links center/right
- Rounded container or transparent
- Subtle border bottom (`border-b border-white/10`)

#### Mobile (Bottom Nav)
- **Floating pill-shaped bar** (NOT edge-to-edge)
- Position: fixed bottom with margin (`bottom-4 left-4 right-4`)
- Shape: `rounded-full` or `rounded-3xl`
- Background: Glassmorphic dark (`bg-slate-900/90 backdrop-blur-xl`)
- Icons with labels below
- Active state: highlighted background + accent color
- Shadow: `shadow-2xl` for floating effect
- Safe area padding for notched devices

### Cards

#### Standard Card
- `rounded-2xl` to `rounded-3xl` (very rounded)
- Glassmorphic: `bg-card/70 backdrop-blur-md`
- Border: `border border-white/10`
- Shadow: `shadow-lg shadow-black/20`
- Padding: `p-4` to `p-6`

#### Dashboard Card (Quick Access style)
- Icon + title + subtitle layout
- Icon in rounded container with accent background
- Hover: lift + shadow increase
- Grid layout: 2 columns on mobile, 4 on desktop

#### Stat Card (Weather widget style)
- Large primary value (temperature, count, etc.)
- Secondary meta info below
- Optional icon
- Full-width or half-width variants

#### Room/Section Card (My Devices style)
- Icon or emoji header
- Title + device count
- Accent color strip or background
- Tap to expand/navigate

### Buttons

#### Primary Button
- `rounded-full` (pill shape)
- Solid accent background
- White text
- Hover: slight lift (`hover:-translate-y-0.5`) + brighter
- Press: scale down (`active:scale-[0.98]`)
- Shadow on hover

#### Secondary Button
- `rounded-full`
- Transparent or ghost background
- Border: `border border-white/20`
- Hover: background fill
- Press: scale down

#### Icon Button
- Circular: `rounded-full w-10 h-10` or `w-12 h-12`
- Center-aligned icon
- Subtle background on hover

### Modals & Sheets
- Desktop: centered modals with `rounded-2xl`
- Mobile: bottom sheets preferred, slide up animation
- Glassmorphic backgrounds
- Overlay: `bg-black/60 backdrop-blur-sm`

### Tables & Lists
- Readable spacing (`py-3` per row)
- Clear row separation (subtle border or alternating bg)
- Action affordances obvious
- Rounded container: `rounded-xl overflow-hidden`

### Input Fields
- `rounded-xl` to `rounded-2xl`
- Glassmorphic background for dark theme
- Clear focus ring
- Placeholder text muted

### Search Bar
- Full-width on mobile
- `rounded-full` or `rounded-2xl`
- Left-aligned search icon
- Glassmorphic background

---

## Dashboard Layout

### Mobile Dashboard Structure
```
┌─────────────────────────────┐
│ Header: Avatar + Greeting   │
│ Search Bar                  │
├─────────────────────────────┤
│ Hero Card (Weather/Stats)   │
├─────────────────────────────┤
│ Section: "Quick Access"     │
│ ┌─────┐ ┌─────┐            │
│ │Card │ │Card │            │
│ └─────┘ └─────┘            │
│ ┌─────┐ ┌─────┐            │
│ │Card │ │Card │            │
│ └─────┘ └─────┘            │
├─────────────────────────────┤
│ Section: "My Items"         │
│ ┌───────────┐ ┌───────────┐│
│ │ Room Card │ │ Room Card ││
│ └───────────┘ └───────────┘│
├─────────────────────────────┤
│ ░░░ Bottom Nav (floating) ░░│
└─────────────────────────────┘
```

### Desktop Dashboard Structure
```
┌──────────────────────────────────────────────┐
│ Top Nav: Logo | Links | Actions              │
├──────────────────────────────────────────────┤
│                                              │
│  Hero Section (full-width or split)          │
│  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Headline Text   │  │ Floating Card    │  │
│  │ Subtext         │  │ with stats       │  │
│  │ [CTA Buttons]   │  │                  │  │
│  └─────────────────┘  └──────────────────┘  │
│                                              │
├──────────────────────────────────────────────┤
│  Grid: 3-4 columns of cards                  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐               │
│  │    │ │    │ │    │ │    │               │
│  └────┘ └────┘ └────┘ └────┘               │
└──────────────────────────────────────────────┘
```

---

## Animations

### Page Transitions
- Staggered entry: cards fade in with 50-100ms delay each
- Use CSS `animation-delay` or Framer Motion `staggerChildren`

### Card Animations
- Hover: `transform: translateY(-4px)` + shadow increase
- Duration: 200-300ms
- Easing: `ease-out`

### Button Animations
- Hover: lift + glow/shadow
- Press: `scale(0.98)` immediate feedback
- Duration: 150ms

### Navigation Transitions
- Mobile nav: slide up on mount
- Page change: crossfade or slide

### Loading States
- Skeleton cards with shimmer animation
- Pulsing placeholders

---

## Color Usage

### Accent Colors by Context
- **Navigation active**: Primary purple/accent
- **Primary actions**: Solid accent button
- **Destructive**: Red tones
- **Success**: Green tones
- **Warning**: Yellow/amber tones

### Icon Colors
- Default: muted (`text-muted-foreground`)
- Active/selected: accent color
- Inside colored containers: white

---

## Anti-Patterns
- Inline styling
- Duplicate components
- Inconsistent spacing
- Overuse of animation
- **Sharp corners** (use rounded everywhere)
- **Flat cards** (always add depth via shadow/blur)
- **Edge-to-edge mobile nav** (must be floating pill)
- **Generic gray backgrounds** (use purple/violet tones)
- **Boring admin-panel aesthetic** (must feel premium)


