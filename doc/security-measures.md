# Security Overview

Immaculaterr is built with security as a core priority. This page explains how the app protects your data, your credentials, and your privacy — in plain terms.

---

## Your Password Is Never Stored

When you create an account, your password is hashed using **Argon2id** — a modern, memory-hard algorithm designed to be extremely resistant to brute-force attacks. The original password is never saved anywhere. When you sign in, the app re-derives the hash and compares it safely using constant-time comparison to prevent timing attacks.

If you're upgrading from an older version that used PBKDF2, the app automatically re-hashes your password to Argon2id on your next successful login.

---

## Sessions, Not Tokens in Your Browser

Immaculaterr does **not** store authentication tokens in your browser's localStorage or sessionStorage. Instead, it uses **server-side sessions** with an encrypted, httpOnly cookie.

What this means for you:

- **httpOnly** — JavaScript on the page cannot read your session cookie, protecting against XSS attacks.
- **SameSite=Lax** — Your browser won't send the cookie on cross-site requests, reducing CSRF risk.
- **Secure flag** — When running over HTTPS, the cookie is only sent over encrypted connections.
- **Encrypted cookie value** — The session ID inside the cookie is encrypted with AES-256-GCM before being sent to your browser.
- **Hashed in the database** — The session ID is SHA-256 hashed before storage, so even a database leak won't expose active sessions.

---

## 30-Day Rolling Expiration

Your session lasts up to **30 days** by default. Every time you use the app, the expiration window resets — so as long as you're active, you stay signed in. If you stop using the app for 30 days, you'll be asked to sign in again.

Changing your password or using "log out everywhere" immediately invalidates all existing sessions.

---

## Encrypted Credential Transport

When your browser supports it (HTTPS or localhost), Immaculaterr encrypts your username and password **before** they leave the browser using a combination of **RSA-OAEP** and **AES-GCM** — the same standards used in banking and government systems. This is an extra layer of protection on top of HTTPS.

If the browser doesn't support WebCrypto (rare), the app falls back to standard HTTPS-protected JSON.

---

## Secrets Encrypted at Rest

Any sensitive data stored by the app — such as API keys for Radarr, Sonarr, or Plex — is encrypted at rest using **AES-256-GCM** with your deployment's master key. The raw secrets are never written to the database in plain text.

---

## HTTPS and TLS

Immaculaterr ships with a **Caddy** reverse proxy option that handles HTTPS automatically:

- **Local deployments** get automatic local HTTPS via Caddy's built-in certificate authority.
- **Public deployments** get free, auto-renewing certificates from Let's Encrypt via ACME.
- **HSTS headers** are sent in production over HTTPS, telling browsers to always use encrypted connections.
- The CSP (Content Security Policy) adds `upgrade-insecure-requests` when serving over HTTPS.

---

## Brute-Force and Abuse Protection

Multiple layers of rate limiting protect the app from automated attacks:

- **Global API rate limits** — All API endpoints are rate-limited per IP address.
- **Auth-specific limits** — Login, registration, and password recovery have stricter, separate limits.
- **Progressive lockout** — Repeated failed login attempts trigger escalating lockout periods that double with each failure.
- **Optional CAPTCHA** — After a configurable number of failed attempts, CAPTCHA verification can be required.

---

## Security Headers

Every response from the server includes a set of security headers that instruct browsers to enforce strict protections:

| Protection | What It Does |
|------------|-------------|
| Content Security Policy | Restricts where scripts, styles, and connections can load from |
| X-Frame-Options: DENY | Prevents the app from being embedded in iframes (clickjacking protection) |
| X-Content-Type-Options | Stops browsers from guessing file types (MIME sniffing protection) |
| Referrer-Policy | Limits what URL information is shared when navigating away |
| Cross-Origin protections | Isolates the app from other origins in the browser |
| Permissions-Policy | Restricts access to browser features the app doesn't need |
| Cache-Control: no-store | Prevents sensitive API responses from being cached |

---

## Origin Validation

State-changing requests (POST, PUT, PATCH, DELETE) to the API are checked against the server's own hostname. If the request's `Origin` header doesn't match, it's rejected — an additional safeguard against cross-site request forgery.

---

## Cross-Origin Resource Sharing (CORS)

In production, CORS is **disabled by default**. It can be enabled with a strict allowlist of trusted origins via the `CORS_ORIGINS` environment variable. This prevents unauthorized websites from making API calls on your behalf.

---

## Container Security

The Docker image follows hardening best practices:

- Runs as a **non-root user** (uid 10001).
- Uses **`no-new-privileges`** to prevent privilege escalation.
- Drops the **`NET_RAW`** capability.
- Data files and encryption keys are set to **owner-only permissions** (chmod 600/700).
- The master key supports **Docker secrets** for secure injection without environment variable exposure.
- Pre-migration database backups are created automatically with restricted permissions.

---

## Logout and Data Cleanup

When you log out, the app:

1. Invalidates your session on the server.
2. Clears the session cookie.
3. Wipes **all** client-side storage — localStorage, sessionStorage, Cache Storage, and IndexedDB.

Changing your password invalidates **all** active sessions across all devices.

---

## Security Testing

The project includes an automated security pipeline that runs:

- **Static analysis** (Semgrep) for code-level vulnerabilities
- **Dependency auditing** (npm audit) for known vulnerable packages
- **Secret scanning** (TruffleHog) to catch accidentally committed credentials
- **Container scanning** (Trivy) for image vulnerabilities
- **Dynamic testing** (OWASP ZAP) for runtime web vulnerabilities
- **TLS testing** (testssl.sh) for HTTPS configuration issues
- **API fuzzing** (Schemathesis) for unexpected input handling
- **Cypress security specs** for auth, session, CSRF, header, and upload protections

---

## Reporting a Vulnerability

If you find a security issue, please report it via [GitHub Issues](https://github.com/ohmzi/Immaculaterr/issues). Security concerns are prioritized.
