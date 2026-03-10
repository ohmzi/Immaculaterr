/// <reference types="cypress" />

type AuthUser = {
  id?: string;
  username?: string;
};

type LoginResponse = {
  ok?: boolean;
  user?: AuthUser;
  message?: string | string[];
};

type SessionContext = {
  username: string;
  userId: string;
  cookieHeader: string;
};

type ArrCreateResponse = {
  ok?: boolean;
  instance?: {
    id?: string;
    name?: string;
    type?: string;
  };
  message?: string | string[];
};

type EndpointCheck = {
  method: 'GET' | 'POST';
  path: string;
};

const AUTH_LOGIN_PATH = '/api/auth/login';
const REPORT_FILE = 'authorization-cypress.md';
const FRONTEND_SETUP_PATH = '/setup';
const PROTECTED_ENDPOINTS: readonly EndpointCheck[] = [
  { method: 'GET', path: '/api/auth/me' },
  { method: 'GET', path: '/api/auth/recovery/status' },
  { method: 'GET', path: '/api/settings' },
  { method: 'GET', path: '/api/jobs' },
  { method: 'GET', path: '/api/arr-instances' },
  { method: 'GET', path: '/api/integrations/plex/libraries' },
];

const ADMIN_ENDPOINTS: readonly EndpointCheck[] = [
  { method: 'GET', path: '/api/immaculate-taste/collections' },
  {
    method: 'GET',
    path: '/api/collection-artwork/managed-collections?plexUserId=not-a-real-user-id',
  },
];

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readReportDir(): string {
  const configured = readString(Cypress.env('SECURITY_REPORT_DIR'));
  return configured.replace(/\/+$/, '') || 'security/reports';
}

function reportPath(): string {
  return `${readReportDir()}/${REPORT_FILE}`;
}

function appendReportLine(line: string): Cypress.Chainable<null> {
  return cy.writeFile(reportPath(), `${line}\n`, { flag: 'a+' });
}

function readCookieHeader(headers: Record<string, unknown>): string | null {
  const setCookie = headers['set-cookie'];
  const values: string[] = [];
  if (typeof setCookie === 'string') values.push(setCookie);
  if (Array.isArray(setCookie)) {
    values.push(
      ...setCookie.filter((entry): entry is string => typeof entry === 'string'),
    );
  }

  const cookie = values.find((entry) => entry.startsWith('tcp_session='));
  if (!cookie) return null;
  const value = cookie.split(';')[0];
  return value || null;
}

function loginAs(username: string, password: string): Cypress.Chainable<SessionContext | null> {
  return cy
    .request<LoginResponse>({
      method: 'POST',
      url: AUTH_LOGIN_PATH,
      failOnStatusCode: false,
      headers: { 'Content-Type': 'application/json' },
      body: { username, password },
    })
    .then((response) => {
      if (response.status >= 400) return null;
      if (response.body?.ok !== true) return null;
      const cookieHeader = readCookieHeader(response.headers as Record<string, unknown>);
      const userId = readString(response.body?.user?.id);
      if (!cookieHeader || !userId) return null;
      return {
        username,
        userId,
        cookieHeader,
      };
    });
}

function requestWithSession(params: {
  session: SessionContext;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
}): Cypress.Chainable<Cypress.Response<unknown>> {
  return cy.request({
    method: params.method,
    url: params.path,
    failOnStatusCode: false,
    headers: {
      Cookie: params.session.cookieHeader,
      'Content-Type': 'application/json',
    },
    body: params.body,
  });
}

describe('security/authorization', () => {
  let adminSession: SessionContext | null = null;
  let userSession: SessionContext | null = null;

  before(() => {
    const securityMode = readString(Cypress.env('SECURITY_MODE')).toLowerCase() || 'hybrid';
    const header = [
      '# Authorization Security Report',
      '',
      `- generatedAt: ${new Date().toISOString()}`,
      `- baseUrl: ${String(Cypress.config('baseUrl') || '')}`,
      `- securityMode: ${securityMode}`,
      '',
    ].join('\n');

    cy.writeFile(reportPath(), header, { flag: 'w' });

    const adminUsername = readString(Cypress.env('SECURITY_ADMIN_EMAIL'));
    const adminPassword = readString(Cypress.env('SECURITY_ADMIN_PASSWORD'));
    const userUsername = readString(Cypress.env('SECURITY_USER_EMAIL'));
    const userPassword = readString(Cypress.env('SECURITY_USER_PASSWORD'));

    if (!adminUsername || !adminPassword) {
      appendReportLine(
        '- INFO admin login skipped: SECURITY_ADMIN_EMAIL/SECURITY_ADMIN_PASSWORD not set.',
      );
    } else {
      loginAs(adminUsername, adminPassword).then((session) => {
        adminSession = session;
        appendReportLine(
          session
            ? `- INFO admin login ok userId=${session.userId}`
            : '- WARN admin login failed; admin-dependent scenarios may be skipped.',
        );
      });
    }

    if (!userUsername || !userPassword) {
      appendReportLine(
        '- INFO user login skipped: SECURITY_USER_EMAIL/SECURITY_USER_PASSWORD not set.',
      );
    } else if (
      adminUsername &&
      userUsername.toLowerCase() === adminUsername.toLowerCase()
    ) {
      appendReportLine(
        '- SKIP non-admin scenarios: SECURITY_USER_EMAIL matches SECURITY_ADMIN_EMAIL.',
      );
    } else {
      loginAs(userUsername, userPassword).then((session) => {
        userSession = session;
        appendReportLine(
          session
            ? `- INFO user login ok userId=${session.userId}`
            : '- WARN user login failed; non-admin scenarios will be skipped.',
        );
      });
    }
  });

  it('unauthenticated access to protected endpoints is denied', () => {
    cy.wrap(PROTECTED_ENDPOINTS).each((endpoint) => {
      cy.request({
        method: endpoint.method,
        url: endpoint.path,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status, `${endpoint.method} ${endpoint.path}`).to.equal(401);
        appendReportLine(
          `- PASS unauth-denied ${endpoint.method} ${endpoint.path} status=${response.status}`,
        );
      });
    });
  });

  it('unauthenticated user cannot access setup page content', () => {
    cy.clearCookies();

    cy.request({
      method: 'GET',
      url: '/api/auth/me',
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.equal(401);
    });

    cy.visit(FRONTEND_SETUP_PATH, { failOnStatusCode: false });
    cy.contains(/sign in|create admin login/i).should('be.visible');
    cy.contains('HTTP-only update (required)').should('not.exist');

    appendReportLine(`- PASS unauth-frontend-denied GET ${FRONTEND_SETUP_PATH}`);
  });

  it('normal user cannot access admin-only endpoints', () => {
    if (!userSession) {
      appendReportLine(
        '- SKIP admin-only check: no distinct non-admin session available.',
      );
      return;
    }

    cy.wrap(ADMIN_ENDPOINTS).each((endpoint) => {
      requestWithSession({
        session: userSession as SessionContext,
        method: endpoint.method,
        path: endpoint.path,
      }).then((response) => {
        expect(response.status, `${endpoint.method} ${endpoint.path}`).to.be.greaterThan(
          399,
        );
        appendReportLine(
          `- PASS admin-only denied ${endpoint.method} ${endpoint.path} status=${response.status}`,
        );
      });
    });
  });

  it('normal user cannot modify another user settings/profile endpoints', () => {
    if (!adminSession || !userSession) {
      appendReportLine(
        '- SKIP cross-user modification checks: requires both admin and non-admin sessions.',
      );
      return;
    }

    const instanceName = `security-idor-mod-${Date.now()}`;
    let foreignInstanceId: string | null = null;

    requestWithSession({
      session: adminSession,
      method: 'POST',
      path: '/api/arr-instances',
      body: {
        type: 'radarr',
        name: instanceName,
        baseUrl: 'http://127.0.0.1:9',
        apiKey: 'security-test-key',
      },
    }).then((createResponse) => {
      const createBody = (createResponse.body ?? {}) as ArrCreateResponse;
      const id = readString(createBody.instance?.id);

      if (createResponse.status >= 400 || !id) {
        appendReportLine(
          `- SKIP cross-user modification checks: could not create admin-owned arr instance (status=${createResponse.status}).`,
        );
        return;
      }

      foreignInstanceId = id;

      requestWithSession({
        session: userSession as SessionContext,
        method: 'PUT',
        path: `/api/arr-instances/${id}`,
        body: { name: 'attempted-idor-update' },
      }).then((updateResponse) => {
        expect(updateResponse.status).to.be.oneOf([403, 404]);
        appendReportLine(
          `- PASS cross-user update denied PUT /api/arr-instances/${id} status=${updateResponse.status}`,
        );
      });

      requestWithSession({
        session: userSession as SessionContext,
        method: 'DELETE',
        path: `/api/arr-instances/${id}`,
      }).then((deleteResponse) => {
        expect(deleteResponse.status).to.be.oneOf([403, 404]);
        appendReportLine(
          `- PASS cross-user delete denied DELETE /api/arr-instances/${id} status=${deleteResponse.status}`,
        );
      });
    });

    cy.then(() => {
      if (!foreignInstanceId) return;
      requestWithSession({
        session: adminSession as SessionContext,
        method: 'DELETE',
        path: `/api/arr-instances/${foreignInstanceId}`,
      });
    });
  });

  it('normal user cannot read another user protected data', () => {
    if (!adminSession || !userSession) {
      appendReportLine(
        '- SKIP cross-user read checks: requires both admin and non-admin sessions.',
      );
      return;
    }

    const instanceName = `security-idor-read-${Date.now()}`;
    let foreignInstanceId: string | null = null;

    requestWithSession({
      session: adminSession,
      method: 'POST',
      path: '/api/arr-instances',
      body: {
        type: 'radarr',
        name: instanceName,
        baseUrl: 'http://127.0.0.1:9',
        apiKey: 'security-test-key',
      },
    }).then((createResponse) => {
      const createBody = (createResponse.body ?? {}) as ArrCreateResponse;
      const id = readString(createBody.instance?.id);
      if (createResponse.status >= 400 || !id) {
        appendReportLine(
          `- SKIP cross-user read checks: could not create admin-owned arr instance (status=${createResponse.status}).`,
        );
        return;
      }
      foreignInstanceId = id;

      requestWithSession({
        session: userSession as SessionContext,
        method: 'GET',
        path: `/api/arr-instances/${id}/options?type=radarr`,
      }).then((readResponse) => {
        expect(readResponse.status).to.be.oneOf([403, 404]);
        appendReportLine(
          `- PASS cross-user read denied GET /api/arr-instances/${id}/options status=${readResponse.status}`,
        );
      });
    });

    cy.then(() => {
      if (!foreignInstanceId) return;
      requestWithSession({
        session: adminSession as SessionContext,
        method: 'DELETE',
        path: `/api/arr-instances/${foreignInstanceId}`,
      });
    });
  });

  it('cross-user reads deny access or filter sensitive fields', () => {
    if (!adminSession || !userSession) {
      appendReportLine(
        '- SKIP cross-user response-shape check: requires both admin and non-admin sessions.',
      );
      return;
    }

    const instanceName = `security-idor-filter-${Date.now()}`;
    let foreignInstanceId: string | null = null;

    requestWithSession({
      session: adminSession,
      method: 'POST',
      path: '/api/arr-instances',
      body: {
        type: 'radarr',
        name: instanceName,
        baseUrl: 'http://127.0.0.1:9',
        apiKey: 'security-test-key',
      },
    }).then((createResponse) => {
      const createBody = (createResponse.body ?? {}) as ArrCreateResponse;
      const id = readString(createBody.instance?.id);
      if (createResponse.status >= 400 || !id) {
        appendReportLine(
          `- SKIP cross-user response-shape check: could not create admin-owned arr instance (status=${createResponse.status}).`,
        );
        return;
      }
      foreignInstanceId = id;

      requestWithSession({
        session: userSession as SessionContext,
        method: 'GET',
        path: `/api/arr-instances/${id}/options?type=radarr`,
      }).then((readResponse) => {
        expect(readResponse.status).to.be.greaterThan(399);
        const raw = JSON.stringify(readResponse.body ?? {});
        expect(raw).not.to.include('apiKey');
        expect(raw).not.to.include('token');
        appendReportLine(
          `- PASS cross-user response protected GET /api/arr-instances/${id}/options status=${readResponse.status}`,
        );
      });
    });

    cy.then(() => {
      if (!foreignInstanceId) return;
      requestWithSession({
        session: adminSession as SessionContext,
        method: 'DELETE',
        path: `/api/arr-instances/${foreignInstanceId}`,
      });
    });
  });
});
