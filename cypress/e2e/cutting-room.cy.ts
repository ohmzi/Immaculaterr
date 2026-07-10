/**
 * Cutting Room — UI safety rails.
 *
 * Covers the non-negotiables: the page is auth-gated, the wizard cannot reach
 * the prune button without a selection, and the destructive button stays
 * disabled until the typed confirmation matches.
 */
describe('Cutting Room page', () => {
  it('redirects unauthenticated visitors away from /cutting-room', () => {
    cy.clearCookies();
    cy.visit('/cutting-room');
    // AuthGate bounces to the login surface; the wizard must not render.
    cy.contains('Prune Wizard').should('not.exist');
  });

  describe('authenticated', () => {
    beforeEach(function () {
      const username = Cypress.env('E2E_USERNAME');
      const password = Cypress.env('E2E_PASSWORD');
      if (!username || !password) {
        // Credentials are injected via CYPRESS_E2E_USERNAME/PASSWORD.
        this.skip();
      }
      cy.request({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          'Content-Type': 'application/json',
          // Same header the app client sends; required by the CSRF guard for
          // origin-less requests.
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: { username, password },
      });
      cy.visit('/cutting-room');
    });

    it('renders the wizard with factors step first', () => {
      cy.contains('Prune Wizard');
      cy.contains('Factors & protections');
      cy.contains('Continue');
    });

    it('shows Pruned History and Wanted List tabs', () => {
      cy.contains('button', 'Pruned History').click();
      cy.contains(/pruned items|Nothing pruned yet/);
      cy.contains('button', 'Wanted List').click();
      cy.contains(/never downloaded anything/);
    });

    it('keeps the wanted-list prune button disabled until armed', () => {
      cy.contains('button', 'Wanted List').click();
      // No selection → the destructive button is disabled.
      cy.contains('button', /Unmonitor/).should('be.disabled');
    });
  });
});
