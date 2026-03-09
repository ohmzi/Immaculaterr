#!/usr/bin/env node

// skipcq: JS-0833
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
    name: 'pull request trigger includes develop branch',
    snippet: '      - develop',
  },
  {
    name: 'pull request trigger includes master branch',
    snippet: '      - master',
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
    name: 'merge publish computes beta marker from version',
    snippet: 'echo "is_beta=${IS_BETA}"',
  },
  {
    name: 'merge publish gates latest tags to non-beta versions',
    snippet: 'if [[ "${IS_BETA}" != "true" ]]; then',
  },
  {
    name: 'beta publish job exists',
    snippet: '  build-and-push-beta:',
  },
  {
    name: 'beta publish gated to merged PRs into develop (excluding master back-merge)',
    snippet: withWorkflowExpression(
      "github.event_name == 'pull_request' && github.event.action == 'closed' && github.event.pull_request.merged == true && github.event.pull_request.base.ref == 'develop' && github.event.pull_request.head.ref != 'master'",
    ),
  },
  {
    name: 'beta publish includes ghcr beta tag',
    snippet: 'echo "${GHCR_IMAGE}:beta"',
  },
  {
    name: 'beta publish includes docker hub beta tag',
    snippet: 'echo "${DOCKERHUB_IMAGE}:beta"',
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
    name: 'release job runs only for non-beta versions',
    snippet: withWorkflowExpression("needs.build-and-push.outputs.is_beta != 'true'"),
  },
  {
    name: "release notes include what's changed heading",
    snippet: "## What's Changed",
  },
  {
    name: 'release notes include full changelog link',
    snippet: '**Full Changelog**:',
  },
  {
    name: 'release notes include updating heading',
    snippet: '## Updating',
  },
  {
    name: 'release notes include docker heading',
    snippet: '### Docker',
  },
  {
    name: 'release notes include required HTTP-only label',
    snippet: 'HTTP-only update (required)',
  },
  {
    name: 'release notes include version-pinned docker pull',
    snippet: `docker pull ohmzii/immaculaterr:v\${VERSION}`,
  },
  {
    name: 'release notes include docker option A single-container run',
    snippet: '--name Immaculaterr \\',
  },
  {
    name: 'release notes include optional HTTPS sidecar label',
    snippet: 'Optional HTTPS sidecar (can run anytime later)',
  },
  {
    name: 'release notes include sidecar container name',
    snippet: '--name ImmaculaterrHttps \\',
  },
  {
    name: 'release notes remove only caddy container for sidecar refresh',
    snippet: 'docker rm -f ImmaculaterrHttps 2>/dev/null || true',
  },
  {
    name: 'release notes fetch sidecar caddy entrypoint from release tag',
    snippet: `v\${VERSION}/docker/immaculaterr/caddy-entrypoint.sh`,
  },
  {
    name: 'release notes include sidecar internal port bridge to app',
    snippet: '-e APP_INTERNAL_PORT=5454 \\',
  },
  {
    name: 'release notes include portainer heading',
    snippet: '### Portainer',
  },
  {
    name: 'release notes include portainer recreate flow',
    snippet: '1. In Portainer: **Containers** → select **Immaculaterr**',
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
