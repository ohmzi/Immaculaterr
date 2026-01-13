Version History
===

This file tracks notable changes by version.

Unreleased (develop)
---

- _Add entries here as changes land on `develop`._

v1.0.0.0
---

- **Observatory (Immaculate Taste)**:
  - Swipe-card review UI for both Movies and TV.
  - Optional **“Approval required from Observatory”** mode to gate Radarr/Sonarr requests behind right-swipes.
  - Undo support and a 2-minute batched apply that syncs Plex + ARR changes.
- **Observatory (Based on Latest Watched)**:
  - Same swipe/undo/apply workflow as Immaculate, with a 2-stage flow:
    - **Based on your recently watched** suggestions first
    - **Change of Taste** suggestions second
  - Optional approval-gating toggle in Task Manager for this job as well.
- **Based on Latest Watched job improvements**:
  - Added persistent per-library dataset fields needed for Observatory: approval state, “sent to ARR” timestamps, and cached poster path.
  - When approval-gating is enabled, missing items are saved as **pending approval** instead of being sent to ARR immediately.
- **UI polish**:
  - Observatory styling and spacing improvements across tabs and controls.
  - “Run now” dialog input fields aligned consistently.

v0.0.0.101
---

- GHCR publishing + GitHub Release created for a tagged build.
- In-app update awareness (toast + Help menu) and version metadata surfaced in the UI.

v0.0.0.100
---

- Initial tagged release.

