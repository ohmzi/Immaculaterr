#!/usr/bin/env node

// skipcq: JS-0833
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowPath = resolve(
  process.cwd(),
  '.github/workflows/ci-quality-security.yml',
);

const workflow = readFileSync(workflowPath, 'utf8');

const requiredSnippets = [
  {
    name: 'workflow name',
    snippet: 'name: "CI: quality and security"',
  },
  {
    name: 'pull request trigger exists',
    snippet: 'pull_request:',
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
    name: 'permissions read-only',
    snippet: 'contents: read',
  },
  {
    name: 'node version 24',
    snippet: 'node-version: 24',
  },
  {
    name: 'lint step exists',
    snippet: 'npm run lint',
  },
  {
    name: 'build step exists',
    snippet: 'npm run build',
  },
  {
    name: 'test step exists',
    snippet: 'npm run test',
  },
  {
    name: 'AJV safety check step exists',
    snippet: 'npm run security:check:ajv',
  },
  {
    name: 'dependency audit step exists',
    snippet: 'npm run security:audit:prod',
  },
  {
    name: 'quality-and-security job exists',
    snippet: '  quality-and-security:',
  },
  {
    name: 'ripgrep installed for AJV check',
    snippet: 'ripgrep',
  },
];

const missing = requiredSnippets.filter(({ snippet }) => !workflow.includes(snippet));

if (missing.length > 0) {
  const details = missing.map((item) => `- ${item.name}`).join('\n');
  throw new Error(
    `ci-quality-security workflow contract failed.\nMissing expected entries:\n${details}\nPath: ${workflowPath}`,
  );
}

process.stdout.write('ci-quality-security workflow contract passed\n');
