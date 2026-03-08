/// <reference types="cypress" />

type SecurityMode = 'hybrid' | 'strict' | 'report';

type AuthResponseBody = {
  ok?: boolean;
  user?: {
    id?: string;
    username?: string;
  };
};

type ProbeObservation = {
  target: string;
  status: number;
  message: string;
  blockedByHostGuard: boolean;
};

type SessionContext = {
  cookieHeader: string;
};

const LOGIN_PATH = '/api/auth/login';
const SSRF_TEST_PATH = '/api/integrations/test/overseerr';
const REPORT_FILE = 'ssrf-cypress.md';
const OBSERVATIONS_FILE = 'ssrf-observations.json';

const METADATA_HOST_TARGETS = [
  'http://169.254.169.254',
  'http://metadata.google.internal',
  'http://metadata.azure.internal',
] as const;

const LOCAL_PROBE_TARGETS = [
  'http://127.0.0.1',
  'http://localhost',
  'http://192.168.1.10',
] as const;

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

function readSessionCookie(headers: Record<string, unknown>): string | null {
  const setCookie = headers['set-cookie'];
  const values: string[] = [];

  if (typeof setCookie === 'string') values.push(setCookie);
  if (Array.isArray(setCookie)) {
    values.push(
      ...setCookie.filter((entry): entry is string => typeof entry === 'string'),
    );
  }

  const matched = values.find((entry) => entry.startsWith('tcp_session='));
  if (!matched) return null;
  const cookieHeader = matched.split(';')[0];
  return cookieHeader || null;
}

function loginWithConfiguredCredentials(): Cypress.Chainable<SessionContext | null> {
  const credentials = resolveCredentials();
  if (!credentials) {
    return appendReportLine(
      '- SKIP login-dependent SSRF checks: SECURITY_ADMIN_* or SECURITY_USER_* credentials are not configured.',
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
          `- SKIP login-dependent SSRF checks: login failed status=${response.status}`,
        ).then(() => null);
      }

      const cookieHeader = readSessionCookie(response.headers as Record<string, unknown>);
      if (!cookieHeader) {
        return appendReportLine(
          '- SKIP login-dependent SSRF checks: login succeeded but tcp_session cookie was not observed.',
        ).then(() => null);
      }

      return { cookieHeader } satisfies SessionContext;
    });
}

function readResponseMessage(body: unknown): string {
  if (typeof body === 'string') return body.trim();
  if (!body || typeof body !== 'object') return '';

  const maybeMessage = (body as Record<string, unknown>)['message'];
  if (typeof maybeMessage === 'string') return maybeMessage.trim();
  if (Array.isArray(maybeMessage)) {
    return maybeMessage
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join('; ');
  }

  return '';
}

function isBlockedByHostGuard(body: unknown): boolean {
  return /baseUrl host is not allowed/i.test(readResponseMessage(body));
}

describe('security/ssrf', () => {
  const securityMode = readSecurityMode();

  before(() => {
    const header = [
      '# SSRF Security Report',
      '',
      `- generatedAt: ${new Date().toISOString()}`,
      `- baseUrl: ${String(Cypress.config('baseUrl') || '')}`,
      `- securityMode: ${securityMode}`,
      '- INFO scope: integration test endpoint baseUrl validation and host guard behavior.',
      '',
    ].join('\n');

    cy.writeFile(reportPath(REPORT_FILE), header, { flag: 'w' });
  });

  it('denies cloud metadata host targets', () => {
    loginWithConfiguredCredentials().then((session) => {
      if (!session) return;

      cy.wrap([...METADATA_HOST_TARGETS]).each((target) => {
        cy.request({
          method: 'POST',
          url: SSRF_TEST_PATH,
          failOnStatusCode: false,
          headers: {
            Cookie: session.cookieHeader,
            'Content-Type': 'application/json',
          },
          body: {
            baseUrl: target,
          },
        }).then((response) => {
          const blocked = isBlockedByHostGuard(response.body);
          expect(response.status, target).to.equal(400);
          expect(blocked, target).to.equal(true);
          appendReportLine(
            `- PASS metadata-host-block target=${target} status=${response.status}`,
          );
        });
      });
    });
  });

  it('records localhost/private-range probe outcomes (report-only in hybrid)', () => {
    loginWithConfiguredCredentials().then((session) => {
      if (!session) return;

      const observations: ProbeObservation[] = [];

      cy.wrap([...LOCAL_PROBE_TARGETS]).each((target) => {
        cy.request({
          method: 'POST',
          url: SSRF_TEST_PATH,
          failOnStatusCode: false,
          headers: {
            Cookie: session.cookieHeader,
            'Content-Type': 'application/json',
          },
          body: {
            baseUrl: target,
          },
        }).then((response) => {
          const message = readResponseMessage(response.body);
          const blockedByHostGuard = isBlockedByHostGuard(response.body);
          observations.push({
            target,
            status: response.status,
            message,
            blockedByHostGuard,
          });

          expect(response.status, target).to.be.lessThan(500);
          appendReportLine(
            `- INFO localhost-private-probe target=${target} status=${response.status} blockedByHostGuard=${blockedByHostGuard}`,
          );
        });
      });

      cy.then(() => {
        cy.writeFile(
          reportPath(OBSERVATIONS_FILE),
          {
            generatedAt: new Date().toISOString(),
            securityMode,
            observations,
          },
          { flag: 'w' },
        );
      });
    });
  });
});
