/// <reference types="cypress" />

type SecurityMode = 'hybrid' | 'strict' | 'report';

type UploadObservation = {
  label: string;
  fileName: string;
  mimeType: string;
  status: number;
  responseSnippet: string;
};

const WEBHOOK_UPLOAD_PATH = '/api/webhooks/plex';
const REPORT_FILE = 'file-upload-cypress.md';
const OBSERVATIONS_FILE = 'file-upload-observations.json';

const SUSPICIOUS_UPLOAD_CASES = [
  {
    label: 'dangerous-extension-php',
    fileName: 'shell.php',
    mimeType: 'application/x-php',
    content: '<?php echo "pwn"; ?>',
  },
  {
    label: 'double-extension',
    fileName: 'poster.jpg.php',
    mimeType: 'image/jpeg',
    content: 'not-a-real-jpeg-payload',
  },
  {
    label: 'scriptable-svg',
    fileName: 'poster.svg',
    mimeType: 'image/svg+xml',
    content:
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script><rect width="10" height="10"/></svg>',
  },
  {
    label: 'content-type-mismatch',
    fileName: 'poster.jpg',
    mimeType: 'text/plain',
    content: '<script>alert("mime-mismatch")</script>',
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

function trimForReport(input: string): string {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 220)}...`;
}

function postWebhookMultipart(params: {
  fileName: string;
  mimeType: string;
  content: string;
}): Cypress.Chainable<{
  status: number;
  responseText: string;
}> {
  return cy.then(async () => {
    const baseUrl = String(Cypress.config('baseUrl') || '').replace(/\/+$/, '');
    const form = new FormData();

    form.set(
      'payload',
      JSON.stringify({
        event: 'library.on.deck',
        Metadata: {
          title: 'Security Upload Probe',
          type: 'movie',
          librarySectionID: 1,
        },
      }),
    );

    const blob = new Blob([params.content], { type: params.mimeType });
    const file = new File([blob], params.fileName, { type: params.mimeType });
    form.set('file', file);

    const response = await fetch(`${baseUrl}${WEBHOOK_UPLOAD_PATH}`, {
      method: 'POST',
      body: form,
    });
    const responseText = await response.text();

    return {
      status: response.status,
      responseText,
    };
  });
}

describe('security/file-upload', () => {
  const securityMode = readSecurityMode();

  before(() => {
    const header = [
      '# File Upload Security Report',
      '',
      `- generatedAt: ${new Date().toISOString()}`,
      `- baseUrl: ${String(Cypress.config('baseUrl') || '')}`,
      `- securityMode: ${securityMode}`,
      '- INFO scope: suspicious multipart uploads against /api/webhooks/plex.',
      '',
    ].join('\n');

    cy.writeFile(reportPath(REPORT_FILE), header, { flag: 'w' });
  });

  it('accepts or rejects suspicious uploads without 5xx crash behavior', () => {
    const observations: UploadObservation[] = [];

    cy.wrap([...SUSPICIOUS_UPLOAD_CASES]).each((testCase) => {
      postWebhookMultipart({
        fileName: testCase.fileName,
        mimeType: testCase.mimeType,
        content: testCase.content,
      }).then((result) => {
        observations.push({
          label: testCase.label,
          fileName: testCase.fileName,
          mimeType: testCase.mimeType,
          status: result.status,
          responseSnippet: trimForReport(result.responseText),
        });

        expect(result.status, testCase.label).to.be.lessThan(500);
        appendReportLine(
          `- INFO suspicious-upload ${testCase.label} status=${result.status} file=${JSON.stringify(testCase.fileName)} mime=${JSON.stringify(testCase.mimeType)}`,
        );
      });
    });

    cy.then(() => {
      const hasServerError = observations.some((entry) => entry.status >= 500);
      expect(hasServerError).to.equal(false);

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
