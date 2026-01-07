import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PlexPin } from './plex.types';

function sanitizeUrlForLogs(raw: string): string {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    for (const k of [
      'X-Plex-Token',
      'x-plex-token',
      'token',
      'authToken',
      'auth_token',
      'plexToken',
      'plex_token',
    ]) {
      if (u.searchParams.has(k)) u.searchParams.set(k, 'REDACTED');
    }
    return u.toString();
  } catch {
    return raw;
  }
}

@Injectable()
export class PlexService {
  private readonly logger = new Logger(PlexService.name);
  private readonly clientIdentifier: string;

  constructor() {
    // Plex expects this identifier to be consistent while polling a PIN.
    // We’ll persist it once we add DB-backed settings.
    this.clientIdentifier = process.env.PLEX_CLIENT_IDENTIFIER ?? randomUUID();
  }

  async createPin() {
    // strong=true creates a PIN that generates a permanent (non-expiring) auth token
    // The PIN itself expires in ~30 minutes, but the resulting auth token never expires
    const url = 'https://plex.tv/api/v2/pins?strong=true';
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getPlexHeaders(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex.tv HTTP POST ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
      );
      throw new BadGatewayException(
        `Plex PIN create failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as PlexPin;
    const ms = Date.now() - startedAt;
    this.logger.log(`Plex.tv HTTP POST ${safeUrl} -> ${res.status} (${ms}ms)`);
    this.logger.log(`Created Plex PIN id=${data.id}`);

    // Plex OAuth-style page (NOT plex.tv/link which is the 4-character “Link Account” flow).
    const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
      this.clientIdentifier,
    )}&code=${encodeURIComponent(data.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(
      'Immaculaterr',
    )}`;

    return {
      id: data.id,
      expiresAt: data.expiresAt ?? null,
      authUrl,
      clientIdentifier: this.clientIdentifier,
    };
  }

  async checkPin(pinId: number) {
    const url = `https://plex.tv/api/v2/pins/${pinId}`;
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    const res = await fetch(url, {
      method: 'GET',
      headers: this.getPlexHeaders(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
      );
      throw new BadGatewayException(
        `Plex PIN check failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as PlexPin;
    const ms = Date.now() - startedAt;
    this.logger.log(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);
    if (data.authToken) {
      this.logger.log(`Plex PIN authorized id=${data.id}`);
    }
    return {
      id: data.id,
      authToken: data.authToken ?? null,
      expiresAt: data.expiresAt ?? null,
    };
  }

  async whoami(plexToken: string) {
    const url = 'https://plex.tv/api/v2/user';
    const safeUrl = sanitizeUrlForLogs(url);
    const startedAt = Date.now();

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...this.getPlexHeaders(),
        'X-Plex-Token': plexToken,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const ms = Date.now() - startedAt;
      this.logger.warn(
        `Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim(),
      );
      throw new BadGatewayException(
        `Plex whoami failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const ms = Date.now() - startedAt;
    this.logger.log(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);

    // Return a minimal, non-sensitive subset for diagnostics.
    return {
      id: data['id'] ?? null,
      uuid: data['uuid'] ?? null,
      username: data['username'] ?? null,
      title: data['title'] ?? null,
    };
  }

  private getPlexHeaders(): Record<string, string> {
    // https://support.plex.tv/articles/plex-api/
    return {
      Accept: 'application/json',
      'X-Plex-Client-Identifier': this.clientIdentifier,
      'X-Plex-Product': 'Immaculaterr',
      'X-Plex-Version': '0.0.0',
      'X-Plex-Device': 'Server',
      'X-Plex-Device-Name': 'Immaculaterr',
      'X-Plex-Platform': 'Web',
      'X-Plex-Platform-Version': process.version,
    };
  }
}
