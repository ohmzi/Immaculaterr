# Design System

## Design Goals
- Clean, modern, premium aesthetic
- Consistent across desktop and mobile
- Subtle depth and motion
- Accessible and readable

---

## Visual Reference (CANONICAL)

The UI must match the aesthetic of the **provided reference images**:

### Mobile Reference
- **Theme**: Deep purple/violet dark mode
- **Cards**: Glassmorphic with blur, semi-transparent dark backgrounds
- **Corners**: Very rounded (`rounded-2xl` to `rounded-3xl`)
- **Navigation**: Floating pill-shaped bottom nav bar
- **Layout**: Card-based dashboard with grid sections
- **Depth**: Heavy use of shadows, blur, layering
- **Widgets**: Weather-card style info blocks with icons
- **Sections**: "Quick Access" grid, "My Devices" room cards
- **Header**: User greeting with avatar, search bar

### Desktop Reference
- **Theme**: Can use bold accent colors (yellow, etc.) on dark backgrounds
- **Cards**: Floating cards overlaying imagery/gradients
- **Corners**: Very rounded buttons and cards
- **Buttons**: Pill-shaped (`rounded-full`) with clear borders
- **Typography**: Bold headlines, strong hierarchy
- **Layout**: Hero sections with floating UI elements
- **Partner/Logo strips**: Clean horizontal rows

### Key Aesthetic Principles
- **Glassmorphism**: Semi-transparent backgrounds with `backdrop-blur`
- **Depth**: Layered cards floating above backgrounds
- **Bold accents**: Strong accent colors (purple, yellow, etc.)
- **Premium feel**: Fintech/SaaS quality, not admin-panel feel

---

## Color & Theme
- **Primary mode**: Dark theme with deep purple/violet tones
- Support light and dark themes
- Use semantic colors (background, surface, accent, destructive)
- Avoid hardcoded colors outside tokens
- **Dark theme palette**:
  - Background: Deep navy/purple (`#0f0a1e`, `#1a1225`, etc.)
  - Surface: Semi-transparent dark (`rgba(30, 20, 50, 0.7)`)
  - Accent: Vibrant purple (`#8b5cf6`), or bold yellow (`#facc15`) for contrast
  - Text: White/light gray with good contrast
- **Gradients**: Subtle purple gradients for backgrounds and highlights

---

## Typography
- Clear hierarchy:
  - Page title: Large, bold (24-32px)
  - Section title: Medium-bold (18-20px)
  - Body: Regular (14-16px)
  - Meta / helper text: Small, muted (12-14px)
- Prefer fewer font sizes with strong spacing
- Use font-weight contrast (400 vs 600/700) for hierarchy

---

## Spacing & Layout
- Consistent spacing scale (4, 8, 12, 16, 24, 32, 48)
- Use whitespace intentionally
- Avoid cramped layouts
- **Card padding**: Generous (16-24px)
- **Grid gaps**: 12-16px between cards
- **Section spacing**: 24-32px between sections

---

## Motion
- Transitions should feel natural and fast (200-300ms)
- Motion supports clarity, not decoration
- Avoid distracting animations
- **Required animations**:
  - Card hover: subtle lift (`translateY(-2px)`) + shadow increase
  - Button press: scale down (`scale(0.98)`)
  - Page entry: staggered fade-in for cards
  - Navigation: smooth transitions between states

---

## Responsive Philosophy
- Desktop ≠ Mobile
- Layouts must adapt structurally
- Navigation patterns must change per device

### Mobile (< 768px)
- Bottom floating pill navigation
- Single-column card layouts
- Full-width sections
- Touch-friendly tap targets (min 44px)
- Sheet-style modals from bottom

### Desktop (≥ 768px)
- Top navigation bar
- Multi-column grid layouts
- Floating cards with more whitespace
- Centered modals
- Hover states visible

---

## Depth & Layering
- **Background layer**: Solid dark or gradient
- **Surface layer**: Glassmorphic cards with blur
- **Floating layer**: Interactive elements, modals
- Use `z-index` intentionally (10, 20, 30, 40, 50)
- Shadows: `shadow-lg` to `shadow-2xl` for floating elements

---

## Accessibility
- Sufficient contrast (WCAG AA minimum)
- Focus states (visible ring on keyboard focus)
- Keyboard navigation where applicable
- Touch targets minimum 44x44px on mobile


