#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowPath = resolve(
  process.cwd(),
  '.github/workflows/publish-containers.yml',
);

const workflow = readFileSync(workflowPath, 'utf8');
const withWorkflowExpression = (expression) =>
  `    if: \${{ ${expression} }}`;

const requiredSnippets = [
  {
    name: 'workflow name',
    snippet: 'name: Publish containers (GHCR + Docker Hub)',
  },
  {
    name: 'pull request trigger exists',
    snippet: 'pull_request:',
  },
  {
    name: 'pull request closed trigger',
    snippet: '      - closed',
  },
  {
    name: 'PR build-check job exists',
    snippet: '  pr-build-check:',
  },
  {
    name: 'PR build-check runs only before close',
    snippet: withWorkflowExpression(
      "github.event_name == 'pull_request' && github.event.action != 'closed'",
    ),
  },
  {
    name: 'PR build-check does not publish',
    snippet: '          push: false',
  },
  {
    name: 'publish workflow validates dockerhub compose stack',
    snippet: 'docker-compose.dockerhub.yml config >/dev/null',
  },
  {
    name: 'merge publish job exists',
    snippet: '  build-and-push:',
  },
  {
    name: 'merge publish gated to merged develop->master PR',
    snippet: withWorkflowExpression(
      "github.event_name == 'pull_request' && github.event.action == 'closed' && github.event.pull_request.merged == true && github.event.pull_request.head.ref == 'develop' && github.event.pull_request.base.ref == 'master'",
    ),
  },
  {
    name: 'merge publish performs image push',
    snippet: '          push: true',
  },
  {
    name: 'docker hub login requires both username and token',
    snippet: withWorkflowExpression(
      "env.DOCKERHUB_TOKEN != '' && env.DOCKERHUB_USERNAME != ''",
    ),
  },
  {
    name: 'release job depends on build-and-push',
    snippet: '      - build-and-push',
  },
  {
    name: 'release notes include docker option A heading',
    snippet: '### Docker Option A: HTTP-only (legacy single container)',
  },
  {
    name: 'release notes include docker option A single-container run',
    snippet: '--name Immaculaterr \\',
  },
  {
    name: 'release notes include docker option B heading',
    snippet: '### Docker Option B: HTTP + HTTPS (recommended, Caddy + app)',
  },
  {
    name: 'release notes include dockerhub compose stack update command',
    snippet: 'docker-compose.dockerhub.yml',
  },
  {
    name: 'release notes recreate both app and caddy containers',
    snippet: 'docker rm -f Immaculaterr ImmaculaterrHttps 2>/dev/null || true',
  },
  {
    name: 'release notes fetch caddy entrypoint for stack boot',
    snippet: 'caddy-entrypoint.sh',
  },
];

const missing = requiredSnippets.filter(({ snippet }) => !workflow.includes(snippet));

if (missing.length > 0) {
  const details = missing.map((item) => `- ${item.name}`).join('\n');
  throw new Error(
    `publish-containers workflow contract failed.\nMissing expected entries:\n${details}\nPath: ${workflowPath}`,
  );
}

process.stdout.write('publish-containers workflow contract passed\n');
