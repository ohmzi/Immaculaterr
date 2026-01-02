import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PlexPin } from './plex.types';

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
    const url = 'https://plex.tv/api/v2/pins?strong=true';

    const res = await fetch(url, {
      method: 'POST',
      headers: this.getPlexHeaders(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Plex PIN create failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as PlexPin;
    this.logger.log(`Created Plex PIN id=${data.id}`);

    // Plex OAuth-style page (NOT plex.tv/link which is the 4-character “Link Account” flow).
    const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
      this.clientIdentifier,
    )}&code=${encodeURIComponent(data.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(
      'Tautulli Curated Plex',
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

    const res = await fetch(url, {
      method: 'GET',
      headers: this.getPlexHeaders(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Plex PIN check failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as PlexPin;
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

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        ...this.getPlexHeaders(),
        'X-Plex-Token': plexToken,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Plex whoami failed: HTTP ${res.status} ${body}`.trim(),
      );
    }

    const data = (await res.json()) as Record<string, unknown>;

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
      'X-Plex-Product': 'Tautulli Curated Plex',
      'X-Plex-Version': '0.0.0',
      'X-Plex-Device': 'Server',
      'X-Plex-Device-Name': 'Tautulli Curated Plex',
      'X-Plex-Platform': 'Web',
      'X-Plex-Platform-Version': process.version,
    };
  }
}
