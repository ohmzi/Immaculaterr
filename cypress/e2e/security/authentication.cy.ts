/// <reference types="cypress" />

type AuthResponseBody = {
  ok?: boolean;
  message?: string | string[];
  retryAfterSeconds?: number | null;
  retryAt?: string | null;
  captchaRequired?: boolean;
  user?: {
    id?: string;
    username?: string;
  };
};

type FailedAttempt = {
  attempt: number;
  status: number;
  message: string;
  retryAfterSeconds: number | null;
  retryAt: string | null;
  captchaRequired: boolean;
  setCookie: boolean;
};

const AUTH_LOGIN_PATH = '/api/auth/login';
const AUTH_ME_PATH = '/api/auth/me';
const RATE_LIMIT_REPORT_FILE = 'authentication-rate-limit.json';
const AUTH_REPORT_FILE = 'authentication-cypress.md';

const SQLI_PAYLOADS = [
  "' OR '1'='1",
  "admin' --",
  "admin') OR ('1'='1",
];

const SENSITIVE_LEAK_PATTERNS = [
  /passwordHash/i,
  /tokenVersion/i,
  /PrismaClient/i,
  /SQLITE/i,
  /stack/i,
  /\bat\s+\w+/i,
];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readMessage(body: AuthResponseBody | null): string {
  if (!body) return '';
  if (typeof body.message === 'string') return body.message.trim();
  if (Array.isArray(body.message)) {
    return body.message
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join('; ');
  }
  return '';
}

function hasSessionCookie(headers: Record<string, unknown>): boolean {
  const setCookie = headers['set-cookie'];
  if (typeof setCookie === 'string') return setCookie.includes('tcp_session=');
  if (Array.isArray(setCookie)) {
    return setCookie.some((entry) =>
      typeof entry === 'string' ? entry.includes('tcp_session=') : false,
    );
  }
  return false;
}

function resolveReportDir(): string {
  const configured = readString(Cypress.env('SECURITY_REPORT_DIR'));
  const withoutTrailingSlash = configured.replace(/\/+$/, '');
  return withoutTrailingSlash || 'security/reports';
}

function reportPath(fileName: string): string {
  return `${resolveReportDir()}/${fileName}`;
}

function appendReportLine(line: string): Cypress.Chainable<null> {
  return cy.writeFile(reportPath(AUTH_REPORT_FILE), `${line}\n`, { flag: 'a+' });
}

function readSecurityMode(): 'hybrid' | 'strict' | 'report' {
  const raw = readString(Cypress.env('SECURITY_MODE')).toLowerCase();
  if (raw === 'strict') return 'strict';
  if (raw === 'report' || raw === 'report-only') return 'report';
  return 'hybrid';
}

function loginRequest(
  username: string,
  password: string,
): Cypress.Chainable<Cypress.Response<AuthResponseBody>> {
  return cy.request<AuthResponseBody>({
    method: 'POST',
    url: AUTH_LOGIN_PATH,
    failOnStatusCode: false,
    headers: {
      'Content-Type': 'application/json',
    },
    body: { username, password },
  });
}

describe('security/authentication', () => {
  const securityMode = readSecurityMode();

  before(() => {
    const header = [
      '# Authentication Security Report',
      '',
      `- generatedAt: ${new Date().toISOString()}`,
      `- baseUrl: ${String(Cypress.config('baseUrl') || '')}`,
      `- securityMode: ${securityMode}`,
      '- SKIP reset-enumeration: forgot/reset-password flow is not implemented in this repository.',
      '',
    ].join('\n');

    cy.writeFile(reportPath(AUTH_REPORT_FILE), header, { flag: 'w' });
  });

  beforeEach(() => {
    cy.clearCookies();
  });

  it('invalid login fails without sensitive leakage', () => {
    loginRequest('security-invalid-user', 'definitely-wrong-password').then(
      (response) => {
        const body = response.body ?? null;
        const responseText = JSON.stringify(body);
        const message = readMessage(body);

        expect(response.status).to.be.greaterThan(399);
        expect(response.status).to.be.lessThan(500);
        expect(Boolean(body?.ok)).to.equal(false);
        expect(hasSessionCookie(response.headers as Record<string, unknown>)).to.equal(
          false,
        );

        for (const pattern of SENSITIVE_LEAK_PATTERNS) {
          expect(responseText).not.to.match(pattern);
        }

        appendReportLine(
          `- PASS invalid-login status=${response.status} message=${JSON.stringify(
            message || '(empty)',
          )}`,
        );
      },
    );

    cy.request({
      method: 'GET',
      url: AUTH_ME_PATH,
      failOnStatusCode: false,
    }).then((meResponse) => {
      expect(meResponse.status).to.equal(401);
    });
  });

  it('SQLi-style credential payload does not bypass authentication', () => {
    const observations: Array<{ payload: string; status: number; message: string }> = [];

    cy.wrap(SQLI_PAYLOADS).each((payload) => {
      loginRequest(payload, payload).then((response) => {
        const message = readMessage(response.body ?? null);
        observations.push({
          payload,
          status: response.status,
          message,
        });
        expect(response.status).to.be.greaterThan(399);
        expect(Boolean(response.body?.ok)).to.equal(false);
        expect(
          hasSessionCookie(response.headers as Record<string, unknown>),
        ).to.equal(false);
      });

      cy.request({
        method: 'GET',
        url: AUTH_ME_PATH,
        failOnStatusCode: false,
      }).then((meResponse) => {
        expect(meResponse.status).to.equal(401);
      });

      cy.clearCookies();
    });

    cy.then(() => {
      const bypassed = observations.some((entry) => entry.status < 400);
      expect(bypassed).to.equal(false);
      appendReportLine(`- PASS sqli-bypass payloads=${observations.length}`);
    });
  });

  it.skip(
    'forgot/reset flow does not expose account existence through observable differences',
    () => {
      // Not applicable for this repository: no forgot/reset-password flow endpoint is implemented.
    },
  );

  it('repeated failed login attempts are measured and reported', () => {
    const maxAttempts = 8;
    const attempts: FailedAttempt[] = [];

    const runAttempt = (attemptNumber: number): Cypress.Chainable<void> => {
      if (attemptNumber > maxAttempts) {
        return cy.wrap(undefined, { log: false });
      }

      return loginRequest('security-bruteforce-user', 'wrong-password').then(
        (response) => {
          const body = response.body ?? null;
          attempts.push({
            attempt: attemptNumber,
            status: response.status,
            message: readMessage(body),
            retryAfterSeconds:
              typeof body?.retryAfterSeconds === 'number'
                ? body.retryAfterSeconds
                : null,
            retryAt:
              typeof body?.retryAt === 'string' ? body.retryAt.trim() : null,
            captchaRequired: body?.captchaRequired === true,
            setCookie: hasSessionCookie(response.headers as Record<string, unknown>),
          });
        },
      ).then(() => runAttempt(attemptNumber + 1));
    };

    runAttempt(1).then(() => {
      const allRejected = attempts.every((entry) => entry.status >= 400);
      expect(allRejected).to.equal(true);

      const lockoutSignalSeen = attempts.some(
        (entry) =>
          (entry.retryAfterSeconds !== null && entry.retryAfterSeconds > 0) ||
          /too many authentication attempts|captcha required/i.test(entry.message),
      );

      const reportPayload = {
        generatedAt: new Date().toISOString(),
        securityMode,
        lockoutSignalSeen,
        attempts,
      };

      cy.writeFile(reportPath(RATE_LIMIT_REPORT_FILE), reportPayload, { flag: 'w' });
      appendReportLine(
        `- INFO brute-force attempts=${attempts.length} lockoutSignalSeen=${lockoutSignalSeen}`,
      );

      if (!lockoutSignalSeen && securityMode === 'strict') {
        expect(lockoutSignalSeen).to.equal(true);
      }
    });
  });
});
