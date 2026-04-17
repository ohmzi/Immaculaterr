# Security Pipeline

Security checks and scanners live here, with reports written to `security/reports/`.

## Run everything

```bash
npm run security:all
```

## Modes

Set `SECURITY_MODE` before running:

- `hybrid` (default): blocking checks fail the pipeline, scanners are warning-only.
- `strict`: any failing check/scanner fails the pipeline.
- `report-only`: never fail the pipeline, report findings only.

## Common env vars

- `SECURITY_REPORT_DIR` (default: `security/reports`)
- `SECURITY_SCAN_TARGET_URL` (default: `http://host.docker.internal:5454/api`) for ZAP
- `SECURITY_SCAN_TARGET_HOST` (default: `127.0.0.1`) for Nmap
- `SECURITY_TLS_TARGET` (default: `localhost:443`) for testssl
- `SECURITY_OPENAPI_URL` (default: `http://host.docker.internal:5454/api/docs-json`) for OpenAPI fuzzing
