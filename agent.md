# Agent Instructions for Tautulli Curated Plex Collection

## Git Workflow Guidelines

### Branch Management
- **Stay within the `feat/ts-web-ui-plex-auth` branch** for all development work
- **DO NOT change branches** during development sessions
- **DO NOT merge to `main` branch** - merging should only be done through proper PR review process

### Commit Practices
- Commit frequently after each meaningful change
- Write clear, descriptive commit messages following conventional commits format:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `refactor:` for code restructuring
  - `style:` for UI/styling changes
  - `docs:` for documentation updates
  - `chore:` for maintenance tasks
- Include a brief description of what changed and why

### Example Commit Messages
```
feat(web): add responsive navigation with animated buttons
fix(api): resolve session cookie authentication issue
style(web): implement CoLabs-inspired floating button design
refactor(jobs): extract job handlers into separate modules
docs: update agent.md with git workflow guidelines
```

## Project Structure

### Apps
- `apps/api/` - NestJS backend API
- `apps/web/` - React + Vite frontend

### Key Technologies
- **Frontend:** React, TailwindCSS v4, shadcn/ui, TanStack Query
- **Backend:** NestJS, Prisma, SQLite
- **Authentication:** Session-based with cookies

## Development Commands

```bash
# Start development servers (API + Web)
npm run dev

# Run API only
npm run dev --workspace=apps/api

# Run Web only
npm run dev --workspace=apps/web

# Database migrations
npm run db:migrate --workspace=apps/api

# Generate Prisma client
npm run db:generate --workspace=apps/api
```

## UI/UX Guidelines

### Design Principles
- Modern, clean aesthetic inspired by premium sites like CoLabs
- Responsive design: mobile-first approach
- Smooth animations and transitions
- Floating button designs with hover/press effects
- Dark/light theme support

### Component Standards
- Use shadcn/ui components as base
- Apply consistent border radius (rounded-xl for cards, rounded-full for buttons)
- Use backdrop blur for glassmorphism effects
- Implement staggered animations for page transitions

