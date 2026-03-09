/// <reference types="cypress" />

type SecurityMode = 'hybrid' | 'strict' | 'report';

type HeaderExpectation = {
  name: string;
  key: string;
  httpsOnly?: boolean;
};

type HeaderResult = {
  name: string;
  key: string;
  status: 'PASS' | 'WARN' | 'SKIP';
  value: string;
  reason?: string;
};

const REPORT_FILE = 'security-headers-cypress.md';
const INVENTORY_FILE = 'security-headers-inventory.json';
const INVENTORY_PATH = '/api/auth/me';

const HEADER_EXPECTATIONS: readonly HeaderExpectation[] = [
  {
    name: 'Content-Security-Policy',
    key: 'content-security-policy',
  },
  {
    name: 'Strict-Transport-Security',
    key: 'strict-transport-security',
    httpsOnly: true,
  },
  {
    name: 'X-Frame-Options',
    key: 'x-frame-options',
  },
  {
    name: 'X-Content-Type-Options',
    key: 'x-content-type-options',
  },
  {
    name: 'Referrer-Policy',
    key: 'referrer-policy',
  },
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

function normalizeHeaderValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(', ');
  }
  return '';
}

describe('security/security-headers', () => {
  const securityMode = readSecurityMode();
  const baseUrl = String(Cypress.config('baseUrl') || '');
  const isHttps = baseUrl.toLowerCase().startsWith('https://');

  before(() => {
    const header = [
      '# Security Headers Inventory Report',
      '',
      `- generatedAt: ${new Date().toISOString()}`,
      `- baseUrl: ${baseUrl}`,
      `- securityMode: ${securityMode}`,
      '- INFO mode: report-only inventory (no hybrid-mode blocking for missing headers).',
      '',
    ].join('\n');

    cy.writeFile(reportPath(REPORT_FILE), header, { flag: 'w' });
  });

  it('inventories common security and transport headers', () => {
    cy.request({
      method: 'GET',
      url: INVENTORY_PATH,
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.be.greaterThan(0);

      const headers = response.headers as Record<string, unknown>;
      const results: HeaderResult[] = [];

      for (const expectation of HEADER_EXPECTATIONS) {
        const value = normalizeHeaderValue(headers[expectation.key]);

        if (expectation.httpsOnly && !isHttps) {
          results.push({
            name: expectation.name,
            key: expectation.key,
            status: 'SKIP',
            value: value || '(missing)',
            reason: 'HTTPS-only expectation on HTTP base URL',
          });
          continue;
        }

        if (value) {
          results.push({
            name: expectation.name,
            key: expectation.key,
            status: 'PASS',
            value,
          });
        } else {
          results.push({
            name: expectation.name,
            key: expectation.key,
            status: 'WARN',
            value: '(missing)',
            reason: 'Header not observed on sampled response',
          });
        }
      }

      const corsOrigin = normalizeHeaderValue(headers['access-control-allow-origin']);
      const corsCredentials = normalizeHeaderValue(
        headers['access-control-allow-credentials'],
      );

      cy.writeFile(
        reportPath(INVENTORY_FILE),
        {
          generatedAt: new Date().toISOString(),
          baseUrl,
          securityMode,
          endpoint: INVENTORY_PATH,
          responseStatus: response.status,
          isHttps,
          results,
          cors: {
            accessControlAllowOrigin: corsOrigin || null,
            accessControlAllowCredentials: corsCredentials || null,
          },
        },
        { flag: 'w' },
      );

      appendReportLine(
        `- INFO sampled-endpoint ${INVENTORY_PATH} status=${response.status}`,
      );

      cy.wrap(results).each((result) => {
        appendReportLine(
          `- ${result.status} ${result.name} value=${JSON.stringify(result.value)}${result.reason ? ` note=${JSON.stringify(result.reason)}` : ''}`,
        );
      });

      appendReportLine(
        `- INFO cors access-control-allow-origin=${JSON.stringify(corsOrigin || '(missing)')} access-control-allow-credentials=${JSON.stringify(corsCredentials || '(missing)')}`,
      );
    });
  });
});
