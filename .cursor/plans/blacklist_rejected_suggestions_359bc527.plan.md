---
name: Blacklist rejected suggestions
overview: Persist a global per-user blacklist for left-swiped (rejected/removed) items and filter them out during suggestion generation for both Observatory decks, while supporting undo to remove from the blacklist.
todos: []
---

# Add rejected-suggestion blacklist

## Goal
Prevent previously left-swiped items from being suggested again by either collection task, using a **global per-user blacklist** that **never expires**.

## Changes
- **Database (Prisma)**
  - Add new model(s) to store rejected titles (movie + TV) keyed by `userId` + external ID.
  - Track: `mediaType`, `tmdbId` (movies), `tvdbId` (TV, if that’s the stable ID we use), `createdAt`, `source` (immaculate vs watched), and optional `reason` (reject/remove).
  - Add unique constraints to prevent duplicates.
  - Files: [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma), new migration under `apps/api/prisma/migrations/`.

- **Record decisions (swipe-left)**
  - On `reject`/`remove`, upsert into blacklist.
  - On `undo`, delete from blacklist (only if the last action was a left-swipe for that item).
  - Files: [apps/api/src/observatory/observatory.service.ts](apps/api/src/observatory/observatory.service.ts).

- **Suggestion generation filters**
  - When building candidate suggestion sets for:
    - Immaculate Taste Collection job
    - Based on Latest Watched Collection job
  - Query blacklist IDs for the user and filter them out before persisting/sending.
  - Files (likely):
    - [apps/api/src/jobs/immaculate-taste-collection.job.ts](apps/api/src/jobs/immaculate-taste-collection.job.ts)
    - [apps/api/src/jobs/basedon-latest-watched-collection.job.ts](apps/api/src/jobs/basedon-latest-watched-collection.job.ts)

- **(Optional) UX**
  - Add a Settings/Observatory control to clear the blacklist (since it never expires).

## Validation
- Left-swipe an item → it disappears from lists (as today) and is added to blacklist.
- Run either job again → that item is not suggested.
- Undo swipe → item is removed from blacklist and can reappear in future runs.

## Implementation todos
- `db-blacklist-model`: Add Prisma model + migration for blacklist.
- `record-swipe-blacklist`: Upsert/delete blacklist entries during record decision + undo.
- `filter-generation`: Exclude blacklisted IDs in both suggestion jobs.
- `verify-e2e`: Manual smoke: swipe left, run jobs, confirm no re-suggest; undo restores.