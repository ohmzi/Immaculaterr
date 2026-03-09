/// <reference types="cypress" />

type ApiResponseBody = {
  ok?: boolean;
  message?: string | string[];
  user?: {
    id?: string;
    username?: string;
  };
};

type LoginAttempt = {
  label: string;
  status: number;
  message: string;
  setCookie: boolean;
};

const REPORT_FILE = 'input-validation-cypress.md';
const OBSERVATIONS_FILE = 'input-validation-observations.json';
const LOGIN_PATH = '/api/auth/login';
const LOGIN_PROOF_PATH = '/api/auth/login-proof';
const AUTH_ME_PATH = '/api/auth/me';
const WEBHOOK_PATH = '/api/webhooks/plex';

const SQL_NOSQL_PAYLOADS = [
  "' OR '1'='1",
  "\" OR \"1\"=\"1",
  '{"$ne":null}',
  '{"$gt":""}',
  "admin' --",
  "admin') OR ('1'='1",
] as const;

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readMessage(body: ApiResponseBody | null): string {
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

function readSecurityMode(): 'hybrid' | 'strict' | 'report' {
  const raw = readString(Cypress.env('SECURITY_MODE')).toLowerCase();
  if (raw === 'strict') return 'strict';
  if (raw === 'report' || raw === 'report-only') return 'report';
  return 'hybrid';
}

function readReportDir(): string {
  const configured = readString(Cypress.env('SECURITY_REPORT_DIR'));
  return configured.replace(/\/+$/, '') || 'security/reports';
}

function reportPath(fileName: string): string {
  return `${readReportDir()}/${fileName}`;
}

function appendReportLine(line: string): Cypress.Chainable<unknown> {
  return cy.writeFile(reportPath(REPORT_FILE), `${line}\n`, { flag: 'a+' });
}

function loginRequest(body: unknown): Cypress.Chainable<Cypress.Response<ApiResponseBody>> {
  return cy.request<ApiResponseBody>({
    method: 'POST',
    url: LOGIN_PATH,
    failOnStatusCode: false,
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

function uniqueUsername(label: string): string {
  const normalized = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `security-${normalized}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

describe('security/input-validation', () => {
  const securityMode = readSecurityMode();

  before(() => {
    const header = [
      '# Input Validation Security Report',
      '',
      `- generatedAt: ${new Date().toISOString()}`,
      `- baseUrl: ${String(Cypress.config('baseUrl') || '')}`,
      `- securityMode: ${securityMode}`,
      '- INFO OpenAPI-fuzz subset skipped in this spec: runtime request-schema validation is not enforced by Nest global pipes in this repository.',
      '',
    ].join('\n');
    cy.writeFile(reportPath(REPORT_FILE), header, { flag: 'w' });
  });

  beforeEach(() => {
    cy.clearCookies();
  });

  it('invalid body types are rejected where validation boundaries exist', () => {
    const cases: Array<{
      label: string;
      path: string;
      body: unknown;
    }> = [
      { label: 'login-string-body', path: LOGIN_PATH, body: '"not-an-object"' },
      { label: 'login-array-body', path: LOGIN_PATH, body: [] },
      { label: 'webhook-json-body', path: WEBHOOK_PATH, body: { payload: 123 } },
    ];

    cy.wrap(cases).each((testCase) => {
      cy.request<ApiResponseBody>({
        method: 'POST',
        url: testCase.path,
        failOnStatusCode: false,
        headers: { 'Content-Type': 'application/json' },
        body: testCase.body,
      }).then((response) => {
        expect(response.status, testCase.label).to.be.greaterThan(399);
        expect(response.status, testCase.label).to.be.lessThan(500);
        appendReportLine(
          `- PASS invalid-body ${testCase.label} status=${response.status}`,
        );
      });
    });
  });

  it('missing required fields are rejected where applicable', () => {
    const cases: Array<{ label: string; path: string; body: unknown }> = [
      { label: 'login-missing-credentials', path: LOGIN_PATH, body: {} },
      { label: 'login-proof-missing-fields', path: LOGIN_PROOF_PATH, body: {} },
      { label: 'webhook-missing-payload', path: WEBHOOK_PATH, body: {} },
    ];

    cy.wrap(cases).each((testCase) => {
      cy.request<ApiResponseBody>({
        method: 'POST',
        url: testCase.path,
        failOnStatusCode: false,
        headers: { 'Content-Type': 'application/json' },
        body: testCase.body,
      }).then((response) => {
        expect(response.status, testCase.label).to.be.greaterThan(399);
        expect(response.status, testCase.label).to.be.lessThan(500);
        appendReportLine(
          `- PASS missing-required ${testCase.label} status=${response.status}`,
        );
      });
    });
  });

  it('unexpected fields are rejected or ignored safely', () => {
    const invalidCredential = uniqueUsername('invalid-credential');
    const payload = {
      username: uniqueUsername('unexpected'),
      password: invalidCredential,
      isAdmin: true,
      role: 'admin',
      tokenVersion: 999,
      scopes: ['*'],
      profile: { privileges: ['elevated'] },
    };

    loginRequest(payload).then((response) => {
      expect(response.status).to.be.greaterThan(399);
      expect(response.status).to.be.lessThan(500);
      expect(hasSessionCookie(response.headers as Record<string, unknown>)).to.equal(
        false,
      );
      appendReportLine(
        `- PASS unexpected-fields login status=${response.status} message=${JSON.stringify(
          readMessage(response.body ?? null) || '(empty)',
        )}`,
      );
    });

    cy.request({
      method: 'GET',
      url: AUTH_ME_PATH,
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.equal(401);
    });
  });

  it('oversized and attack-shaped inputs do not trigger 5xx paths', () => {
    const hugeText = 'A'.repeat(20_000);
    const attackString = `<'"; DROP TABLE users; -- ${hugeText.slice(0, 1200)}`;

    const cases: Array<{ label: string; path: string; body: unknown }> = [
      {
        label: 'login-oversized-credentials',
        path: LOGIN_PATH,
        body: {
          username: uniqueUsername('oversized') + hugeText,
          password: hugeText,
        },
      },
      {
        label: 'login-attack-shaped-envelope',
        path: LOGIN_PATH,
        body: {
          credentialEnvelope: {
            keyId: 'attack',
            purpose: 'auth.login',
            issuedAt: attackString,
            nonce: attackString,
            ciphertext: attackString,
          },
        },
      },
      {
        label: 'webhook-oversized-invalid-json',
        path: WEBHOOK_PATH,
        body: { payload: hugeText },
      },
    ];

    cy.wrap(cases).each((testCase) => {
      cy.request<ApiResponseBody>({
        method: 'POST',
        url: testCase.path,
        failOnStatusCode: false,
        headers: { 'Content-Type': 'application/json' },
        body: testCase.body,
      }).then((response) => {
        expect(response.status, testCase.label).to.be.lessThan(500);
        expect(response.status, testCase.label).to.be.greaterThan(399);
        appendReportLine(
          `- PASS non-5xx ${testCase.label} status=${response.status}`,
        );
      });
    });
  });

  it('SQL/NoSQL-shaped strings do not create auth bypass', () => {
    const observations: LoginAttempt[] = [];

    cy.wrap([...SQL_NOSQL_PAYLOADS]).each((payload, index) => {
      const username = `${uniqueUsername(`injection-${index}`)}-${payload.slice(0, 10)}`;
      loginRequest({
        username,
        password: payload,
      }).then((response) => {
        const entry: LoginAttempt = {
          label: `injection-${index}`,
          status: response.status,
          message: readMessage(response.body ?? null),
          setCookie: hasSessionCookie(response.headers as Record<string, unknown>),
        };
        observations.push(entry);

        expect(response.status).to.be.greaterThan(399);
        expect(entry.setCookie).to.equal(false);
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
      appendReportLine(
        `- PASS injection-no-bypass attempts=${observations.length}`,
      );
    });

    cy.request({
      method: 'GET',
      url: AUTH_ME_PATH,
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.equal(401);
    });
  });

  it('prototype pollution payload does not elevate privileges', () => {
    const globalBefore = ({} as Record<string, unknown>)['admin'];
    expect(globalBefore).to.equal(undefined);

    const payload = JSON.parse(
      '{"username":"security-proto-user","password":"security-proto-pass","__proto__":{"admin":true}}',
    ) as Record<string, unknown>;

    loginRequest(payload).then((response) => {
      expect(response.status).to.be.greaterThan(399);
      expect(response.status).to.be.lessThan(500);
      expect(hasSessionCookie(response.headers as Record<string, unknown>)).to.equal(
        false,
      );
      appendReportLine(
        `- PASS prototype-pollution status=${response.status} message=${JSON.stringify(
          readMessage(response.body ?? null) || '(empty)',
        )}`,
      );
    });

    cy.request({
      method: 'GET',
      url: AUTH_ME_PATH,
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.equal(401);
    });

    const globalAfter = ({} as Record<string, unknown>)['admin'];
    expect(globalAfter).to.equal(undefined);
  });
});
