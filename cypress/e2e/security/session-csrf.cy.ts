/// <reference types="cypress" />

type AuthResponseBody = {
  ok?: boolean;
  message?: string | string[];
  user?: {
    id?: string;
    username?: string;
  };
};

type SecurityMode = 'hybrid' | 'strict' | 'report';

type SessionContext = {
  username: string;
  cookieEntry: string;
  cookieHeader: string;
};

const LOGIN_PATH = '/api/auth/login';
const LOGOUT_PATH = '/api/auth/logout';
const ME_PATH = '/api/auth/me';
const REPORT_FILE = 'session-csrf-cypress.md';
const OBSERVATIONS_FILE = 'session-csrf-observations.json';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readReportDir(): string {
  const configured = readString(Cypress.env('SECURITY_REPORT_DIR'));
  return configured.replace(/\/+$/, '') || 'security/reports';
}

function reportPath(fileName: string): string {
  return `${readReportDir()}/${fileName}`;
}

function appendReportLine(line: string): Cypress.Chainable<null> {
  return cy.writeFile(reportPath(REPORT_FILE), `${line}\n`, { flag: 'a+' });
}

function readSecurityMode(): SecurityMode {
  const raw = readString(Cypress.env('SECURITY_MODE')).toLowerCase();
  if (raw === 'strict') return 'strict';
  if (raw === 'report' || raw === 'report-only') return 'report';
  return 'hybrid';
}

function resolveCredentials(): { username: string; password: string } | null {
  const adminUsername = readString(Cypress.env('SECURITY_ADMIN_EMAIL'));
  const adminPassword = readString(Cypress.env('SECURITY_ADMIN_PASSWORD'));
  if (adminUsername && adminPassword) {
    return { username: adminUsername, password: adminPassword };
  }

  const userUsername = readString(Cypress.env('SECURITY_USER_EMAIL'));
  const userPassword = readString(Cypress.env('SECURITY_USER_PASSWORD'));
  if (userUsername && userPassword) {
    return { username: userUsername, password: userPassword };
  }

  return null;
}

function readSessionCookieEntry(headers: Record<string, unknown>): string | null {
  const setCookie = headers['set-cookie'];
  const values: string[] = [];

  if (typeof setCookie === 'string') values.push(setCookie);
  if (Array.isArray(setCookie)) {
    values.push(
      ...setCookie.filter((entry): entry is string => typeof entry === 'string'),
    );
  }

  const matched = values.find((entry) => entry.startsWith('tcp_session='));
  return matched ?? null;
}

function readCookieHeader(cookieEntry: string): string {
  return cookieEntry.split(';')[0] || cookieEntry;
}

function resolveBaseOrigin(): string | null {
  const baseUrl = readString(Cypress.config('baseUrl'));
  if (!baseUrl) return null;

  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

function loginWithConfiguredCredentials(): Cypress.Chainable<SessionContext | null> {
  const credentials = resolveCredentials();
  if (!credentials) {
    return appendReportLine(
      '- SKIP login-dependent checks: SECURITY_ADMIN_* or SECURITY_USER_* credentials are not configured.',
    ).then(() => null);
  }

  return cy
    .request<AuthResponseBody>({
      method: 'POST',
      url: LOGIN_PATH,
      failOnStatusCode: false,
      headers: { 'Content-Type': 'application/json' },
      body: {
        username: credentials.username,
        password: credentials.password,
      },
    })
    .then((response) => {
      if (response.status >= 400 || response.body?.ok !== true) {
        return appendReportLine(
          `- SKIP login-dependent checks: login failed for configured user status=${response.status}`,
        ).then(() => null);
      }

      const cookieEntry = readSessionCookieEntry(
        response.headers as Record<string, unknown>,
      );
      if (!cookieEntry) {
        return appendReportLine(
          '- SKIP login-dependent checks: successful login did not return tcp_session cookie.',
        ).then(() => null);
      }

      return {
        username: credentials.username,
        cookieEntry,
        cookieHeader: readCookieHeader(cookieEntry),
      } satisfies SessionContext;
    });
}

describe('security/session-csrf', () => {
  const securityMode = readSecurityMode();
  const baseOrigin = resolveBaseOrigin();

  before(() => {
    const header = [
      '# Session and CSRF Security Report',
      '',
      `- generatedAt: ${new Date().toISOString()}`,
      `- baseUrl: ${String(Cypress.config('baseUrl') || '')}`,
      `- securityMode: ${securityMode}`,
      '- INFO auth model: cookie-based session auth via tcp_session.',
      '- INFO CSRF model: origin-check middleware on state-changing API requests.',
      '',
    ].join('\n');

    cy.writeFile(reportPath(REPORT_FILE), header, { flag: 'w' });
  });

  beforeEach(() => {
    cy.clearCookies();
  });

  it('cookie-based auth uses observable security cookie attributes', () => {
    loginWithConfiguredCredentials().then((session) => {
      if (!session) return;

      const cookieLower = session.cookieEntry.toLowerCase();
      const hasHttpOnly = cookieLower.includes('httponly');
      const sameSiteMatch = /(?:^|;)\s*samesite=([^;]+)/i.exec(
        session.cookieEntry,
      );
      const sameSiteValue = (sameSiteMatch?.[1] ?? '').trim().toLowerCase();
      const hasSecure = cookieLower.includes('secure');

      expect(hasHttpOnly).to.equal(true);
      expect(sameSiteValue).to.equal('lax');

      appendReportLine(
        `- PASS cookie-attributes HttpOnly=${hasHttpOnly} SameSite=${sameSiteValue || '(missing)'} Secure=${hasSecure}`,
      );

      if (!hasSecure) {
        const isHttps = String(Cypress.config('baseUrl') || '')
          .toLowerCase()
          .startsWith('https://');
        appendReportLine(
          isHttps
            ? '- WARN cookie-secure-flag missing on HTTPS base URL (report-only in hybrid mode).'
            : '- INFO cookie-secure-flag not set on HTTP base URL (common local-dev posture).',
        );
      }
    });
  });

  it('logout invalidates active session', () => {
    loginWithConfiguredCredentials().then((session) => {
      if (!session) return;

      cy.request({
        method: 'GET',
        url: ME_PATH,
        failOnStatusCode: false,
        headers: {
          Cookie: session.cookieHeader,
        },
      }).then((response) => {
        expect(response.status).to.equal(200);
      });

      cy.request({
        method: 'POST',
        url: LOGOUT_PATH,
        failOnStatusCode: false,
        headers: {
          Cookie: session.cookieHeader,
          'Content-Type': 'application/json',
        },
        body: {},
      }).then((response) => {
        expect(response.status).to.equal(200);
      });

      cy.request({
        method: 'GET',
        url: ME_PATH,
        failOnStatusCode: false,
        headers: {
          Cookie: session.cookieHeader,
        },
      }).then((response) => {
        expect(response.status).to.equal(401);
        appendReportLine('- PASS logout-invalidates-session');
      });
    });
  });

  it('state-changing cookie-auth requests reject cross-origin attempts', () => {
    loginWithConfiguredCredentials().then((session) => {
      if (!session) return;

      const observations: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        securityMode,
        baseOrigin,
        crossOriginStatus: null,
        sameOriginStatus: null,
      };

      cy.request({
        method: 'POST',
        url: LOGOUT_PATH,
        failOnStatusCode: false,
        headers: {
          Cookie: session.cookieHeader,
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: {},
      }).then((response) => {
        observations.crossOriginStatus = response.status;
        expect(response.status).to.equal(403);
        appendReportLine(
          `- PASS csrf-origin-enforcement cross-origin logout blocked status=${response.status}`,
        );
      });

      cy.request({
        method: 'GET',
        url: ME_PATH,
        failOnStatusCode: false,
        headers: {
          Cookie: session.cookieHeader,
        },
      }).then((response) => {
        expect(response.status).to.equal(200);
      });

      cy.request({
        method: 'POST',
        url: LOGOUT_PATH,
        failOnStatusCode: false,
        headers: {
          Cookie: session.cookieHeader,
          ...(baseOrigin ? { Origin: baseOrigin } : {}),
          'Content-Type': 'application/json',
        },
        body: {},
      }).then((response) => {
        observations.sameOriginStatus = response.status;
        expect(response.status).to.equal(200);
        appendReportLine(
          `- PASS csrf-origin-allow same-origin logout allowed status=${response.status}`,
        );
      });

      cy.writeFile(reportPath(OBSERVATIONS_FILE), observations, { flag: 'w' });
    });
  });
});
