import { BadGatewayException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PlexPin } from './plex.types';

@Injectable()
export class PlexService {
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
    return {
      id: data.id,
      code: data.code,
      expiresAt: data.expiresAt ?? null,
      linkUrl: `https://plex.tv/link?code=${encodeURIComponent(data.code)}`,
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
    return {
      id: data.id,
      authToken: data.authToken ?? null,
      expiresAt: data.expiresAt ?? null,
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


