import net from 'node:net';
import os from 'node:os';
import { execSync } from 'node:child_process';

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] ?? []) {
      if (!n || n.internal) continue;
      if (n.family === 'IPv4') ips.push(n.address);
    }
  }
  return ips;
}

async function isPortFree(port, host = '0.0.0.0') {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') return resolve(false);
      return resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

function printPortOwner(port) {
  try {
    const out = execSync(`ss -lptn 'sport = :${port}'`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (out) {
      console.log(out);
    }
  } catch {
    // ignore if ss isn't available
  }
}

const apiPort = Number.parseInt(process.env.PORT ?? '5859', 10);
const webPort = Number.parseInt(process.env.WEB_PORT ?? '5858', 10);

if (!Number.isFinite(apiPort) || apiPort <= 0) {
  console.error(`Invalid API port: PORT=${process.env.PORT}`);
  process.exit(1);
}
if (!Number.isFinite(webPort) || webPort <= 0) {
  console.error(`Invalid web port: WEB_PORT=${process.env.WEB_PORT}`);
  process.exit(1);
}

const lanIps = getLanIps();

const apiFree = await isPortFree(apiPort);
const webFree = await isPortFree(webPort);

if (!apiFree || !webFree) {
  console.error('Dev preflight failed: required ports are already in use.');
  if (!apiFree) {
    console.error(`- API port ${apiPort} is busy (set PORT=... to change).`);
    printPortOwner(apiPort);
  }
  if (!webFree) {
    console.error(`- Web port ${webPort} is busy (set WEB_PORT=... to change).`);
    printPortOwner(webPort);
  }
  process.exit(1);
}

console.log('Dev preflight OK.');
console.log(`- API will start on: http://localhost:${apiPort}/api`);
console.log(`- Web will start on: http://localhost:${webPort}/`);
if (lanIps.length) {
  console.log(`- LAN test: http://${lanIps[0]}:${webPort}/`);
}