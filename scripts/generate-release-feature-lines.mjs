#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION_HISTORY_PATH = resolve(process.cwd(), 'doc/Version_History.md');

const normalizeVersion = (value) =>
  String(value ?? '')
    .trim()
    .replace(/^[vV]/, '')
    .replace(/-beta\b/i, '');

const ensureSentence = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const parseArgs = () => {
  let version = process.env.VERSION ?? '';
  for (let index = 2; index < process.argv.length; index += 1) {
    const token = process.argv[index];
    if ((token === '--version' || token === '-v') && process.argv[index + 1]) {
      version = process.argv[index + 1];
      index += 1;
    }
  }
  return normalizeVersion(version);
};

const targetVersion = parseArgs();
if (!targetVersion) {
  throw new Error(
    'Missing version. Use --version <x.y.z> or set VERSION env before running.',
  );
}

const fileContent = readFileSync(VERSION_HISTORY_PATH, 'utf8');
const lines = fileContent.split(/\r?\n/);

const isVersionHeading = (line) =>
  /^\d+\.\d+\.\d+(?:\.\d+)?(?:-beta)?$/i.test(line.trim());

const startIndex = lines.findIndex(
  (line) => normalizeVersion(line) === targetVersion,
);

if (startIndex < 0) {
  throw new Error(
    `Version ${targetVersion} not found in ${VERSION_HISTORY_PATH}.`,
  );
}

let endIndex = lines.length;
for (let index = startIndex + 1; index < lines.length; index += 1) {
  if (isVersionHeading(lines[index])) {
    endIndex = index;
    break;
  }
}

const sectionLines = lines.slice(startIndex + 1, endIndex);

const headlineGroups = [];
let currentGroup = null;

for (const rawLine of sectionLines) {
  const topLevelMatch = rawLine.match(/^- (.+)$/);
  if (topLevelMatch) {
    const headline = topLevelMatch[1].trim();
    if (/^what'?s new since\b/i.test(headline)) {
      currentGroup = null;
      continue;
    }
    currentGroup = { headline, details: [] };
    headlineGroups.push(currentGroup);
    continue;
  }

  const nestedMatch = rawLine.match(/^  - (.+)$/);
  if (nestedMatch && currentGroup) {
    currentGroup.details.push(nestedMatch[1].trim());
  }
}

const featureLines = [];
const seen = new Set();

for (const group of headlineGroups) {
  const headline = group.headline.replace(/:\s*$/, '').trim();
  if (!headline) continue;
  const firstDetail = group.details[0] ?? '';
  const combined = firstDetail
    ? `${headline}: ${firstDetail}`
    : headline;
  const normalized = ensureSentence(combined);
  const dedupeKey = normalized.toLowerCase();
  if (!normalized || seen.has(dedupeKey)) continue;
  seen.add(dedupeKey);
  featureLines.push(`- ${normalized}`);
}

if (featureLines.length === 0) {
  throw new Error(
    `No feature headline bullets found for version ${targetVersion} in ${VERSION_HISTORY_PATH}.`,
  );
}

process.stdout.write(`${featureLines.join('\n')}\n`);
