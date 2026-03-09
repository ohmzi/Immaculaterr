const baseUrl = process.env.SECURITY_BASE_URL?.trim() || 'http://localhost:5454';

export default {
  video: false,
  e2e: {
    baseUrl,
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: false,
  },
  env: {
    SECURITY_MODE: process.env.SECURITY_MODE?.trim().toLowerCase() || 'hybrid',
    SECURITY_ADMIN_EMAIL: process.env.SECURITY_ADMIN_EMAIL?.trim() || '',
    SECURITY_ADMIN_PASSWORD: process.env.SECURITY_ADMIN_PASSWORD?.trim() || '',
    SECURITY_USER_EMAIL: process.env.SECURITY_USER_EMAIL?.trim() || '',
    SECURITY_USER_PASSWORD: process.env.SECURITY_USER_PASSWORD?.trim() || '',
    SECURITY_REPORT_DIR: process.env.SECURITY_REPORT_DIR?.trim() || 'security/reports',
  },
};
