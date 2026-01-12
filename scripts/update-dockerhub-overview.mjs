import { readFile } from 'node:fs/promises';

const DOCKERHUB_USERNAME = process.env.DOCKERHUB_USERNAME;
const DOCKERHUB_PAT = process.env.DOCKERHUB_PAT;
const DOCKERHUB_REPO = process.env.DOCKERHUB_REPO ?? 'ohmzii/immaculaterr';
const OVERVIEW_PATH = process.env.DOCKERHUB_OVERVIEW_PATH ?? 'doc/DOCKERHUB_OVERVIEW.md';

if (!DOCKERHUB_USERNAME) throw new Error('Missing DOCKERHUB_USERNAME');
if (!DOCKERHUB_PAT) throw new Error('Missing DOCKERHUB_PAT');

async function dockerHubLogin() {
  const res = await fetch('https://hub.docker.com/v2/users/login/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: DOCKERHUB_USERNAME, password: DOCKERHUB_PAT }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Docker Hub login failed: ${res.status} ${res.statusText} ${text}`);
  }
  const json = await res.json();
  if (!json?.token) throw new Error('Docker Hub login response missing token');
  return json.token;
}

async function updateRepoOverview(jwt, fullDescription) {
  const [namespace, name] = DOCKERHUB_REPO.split('/');
  if (!namespace || !name) throw new Error(`Invalid DOCKERHUB_REPO: ${DOCKERHUB_REPO}`);

  const url = `https://hub.docker.com/v2/repositories/${encodeURIComponent(
    namespace,
  )}/${encodeURIComponent(name)}/`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `JWT ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      full_description: fullDescription,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Docker Hub update failed: ${res.status} ${res.statusText} ${text}`);
  }
}

const fullDescription = await readFile(OVERVIEW_PATH, 'utf8');
const jwt = await dockerHubLogin();
await updateRepoOverview(jwt, fullDescription);
console.log(`Updated Docker Hub overview for ${DOCKERHUB_REPO} from ${OVERVIEW_PATH}.`);

