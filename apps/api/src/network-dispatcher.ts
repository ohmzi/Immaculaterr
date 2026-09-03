/**
 * Some hosts (observed on Unraid, both bridge and host Docker networking)
 * advertise IPv6 (AAAA) records for external APIs but have no working IPv6
 * route out of the box, so DNS resolves fine yet every connection attempt
 * hangs until it times out. Node's global `fetch()` (undici) does not
 * consistently honor `--dns-result-order=ipv4first` for its own connector,
 * so every outbound request pays the full timeout before any per-call IPv4
 * fallback kicks in. Forcing the shared dispatcher to resolve/connect over
 * IPv4 only removes that wasted timeout at the root instead of retrying
 * around it per integration.
 */
import { Logger } from '@nestjs/common';
import { Agent, setGlobalDispatcher } from 'undici';
import type { buildConnector } from 'undici';

// undici's own `connect` option type is a union of Node's tls/net connect
// option shapes, each of which declares other fields (e.g. `port`) as
// required; `family` alone is a well-supported subset at runtime (see
// undici's own docs for forcing IPv4), so the assertion below just works
// around the type not modeling that partial-options case.
const IPV4_ONLY_CONNECT_OPTIONS = {
  family: 4,
} as buildConnector.BuildOptions;

const logger = new Logger('NetworkBootstrap');

function isTruthyEnv(raw: string | undefined): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();
  return (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

export function configureIpv4OnlyDispatcher(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isTruthyEnv(env.DISABLE_FORCE_IPV4)) {
    logger.log(
      'Force-IPv4 outbound dispatcher disabled via DISABLE_FORCE_IPV4=true',
    );
    return;
  }

  setGlobalDispatcher(new Agent({ connect: IPV4_ONLY_CONNECT_OPTIONS }));
  logger.log(
    'Outbound HTTP(S) requests forced to IPv4 to avoid hosts with broken/blackholed IPv6 routes ' +
      '(set DISABLE_FORCE_IPV4=true to opt out)',
  );
}
