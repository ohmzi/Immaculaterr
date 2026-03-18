Setup: Local development
===

Run the monorepo locally for development.

[← Back to Setup Guide](setupguide.md)

Getting started
---

```bash
npm install
npm -w apps/api run db:generate
APP_DATA_DIR=./data DATABASE_URL=file:./data/tcp.sqlite npm -w apps/api run db:migrate
APP_DATA_DIR=./data DATABASE_URL=file:./data/tcp.sqlite PORT=5859 WEB_PORT=5858 npm run dev
```

Then open:

- Web UI: `http://localhost:5858/`
- API: `http://localhost:5859/api`
