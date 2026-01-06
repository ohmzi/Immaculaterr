import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const v = pick(obj, path);
  return typeof v === 'string' ? v.trim() : '';
}

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const v = pick(obj, path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number.parseInt(v.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function truncate(value: string, max: number) {
  const s = value.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  async persistPlexWebhookEvent(event: unknown) {
    const baseDir = join(this.getDataDir(), 'webhooks', 'plex');
    await fs.mkdir(baseDir, { recursive: true });

    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
    const path = join(baseDir, filename);

    await fs.writeFile(path, JSON.stringify(event, null, 2), 'utf8');
    this.logger.log(`Persisted Plex webhook event: ${path}`);

    return { path };
  }

  logPlexWebhookSummary(params: {
    payload: unknown;
    persistedPath: string;
    receivedAtIso: string;
    files?: Array<{
      fieldname: string;
      originalname: string;
      mimetype: string;
      size: number;
    }>;
    source?: { ip?: string | null; userAgent?: string | null };
  }) {
    const payloadObj = isPlainObject(params.payload) ? params.payload : null;
    const plexEvent = payloadObj ? pickString(payloadObj, 'event') : '';
    const mediaType = payloadObj ? pickString(payloadObj, 'Metadata.type') : '';

    const title = payloadObj ? pickString(payloadObj, 'Metadata.title') : '';
    const year = payloadObj ? pickNumber(payloadObj, 'Metadata.year') : null;
    const ratingKey = payloadObj ? pickString(payloadObj, 'Metadata.ratingKey') : '';
    const guid = payloadObj ? pickString(payloadObj, 'Metadata.guid') : '';
    const libraryTitle = payloadObj
      ? pickString(payloadObj, 'Metadata.librarySectionTitle')
      : '';
    const libraryId = payloadObj ? pickNumber(payloadObj, 'Metadata.librarySectionID') : null;

    const grandparentTitle = payloadObj
      ? pickString(payloadObj, 'Metadata.grandparentTitle')
      : '';
    const parentIndex = payloadObj ? pickNumber(payloadObj, 'Metadata.parentIndex') : null;
    const index = payloadObj ? pickNumber(payloadObj, 'Metadata.index') : null;

    const accountTitle =
      payloadObj
        ? pickString(payloadObj, 'Account.title') ||
          pickString(payloadObj, 'Account.name') ||
          pickString(payloadObj, 'user') ||
          pickString(payloadObj, 'owner')
        : '';
    const serverTitle = payloadObj ? pickString(payloadObj, 'Server.title') : '';
    const serverUuid = payloadObj ? pickString(payloadObj, 'Server.uuid') : '';
    const playerTitle = payloadObj ? pickString(payloadObj, 'Player.title') : '';
    const playerProduct = payloadObj ? pickString(payloadObj, 'Player.product') : '';
    const playerPlatform = payloadObj ? pickString(payloadObj, 'Player.platform') : '';
    const playerState = payloadObj ? pickString(payloadObj, 'Player.state') : '';

    const viewOffset = payloadObj ? pickNumber(payloadObj, 'Metadata.viewOffset') : null;
    const duration = payloadObj ? pickNumber(payloadObj, 'Metadata.duration') : null;

    const fileCount = params.files?.length ?? 0;
    const fileSummary =
      fileCount > 0
        ? ` files=${fileCount}`
        : '';

    const srcIp = (params.source?.ip ?? '').trim();
    const src =
      srcIp ? ` ip=${srcIp}` : '';

    const base = [
      'Plex webhook:',
      plexEvent || '(unknown)',
      mediaType ? `type=${mediaType}` : null,
      serverTitle ? `server=${JSON.stringify(truncate(serverTitle, 60))}` : null,
      serverUuid ? `uuid=${serverUuid}` : null,
      accountTitle ? `user=${JSON.stringify(truncate(accountTitle, 40))}` : null,
      playerTitle || playerProduct || playerPlatform
        ? `player=${JSON.stringify(
            truncate(
              [playerTitle, playerProduct, playerPlatform]
                .filter(Boolean)
                .join(' / '),
              60,
            ),
          )}`
        : null,
      playerState ? `state=${playerState}` : null,
      libraryTitle
        ? `library=${JSON.stringify(truncate(libraryTitle, 60))}`
        : libraryId !== null
          ? `libraryId=${libraryId}`
          : null,
    ]
      .filter(Boolean)
      .join(' ');

    const meta =
      title || grandparentTitle
        ? (() => {
            if (mediaType.toLowerCase() === 'episode') {
              const show = grandparentTitle || '(show)';
              const s = parentIndex !== null ? `S${parentIndex}` : '';
              const e = index !== null ? `E${index}` : '';
              const se = s || e ? ` ${[s, e].filter(Boolean).join('')}` : '';
              return ` • ${truncate(show, 60)}${se} — ${truncate(title || '(episode)', 80)}`;
            }
            const t = truncate(title || grandparentTitle, 90);
            const y = year ? ` (${year})` : '';
            return ` • ${t}${y}`;
          })()
        : '';

    const ids = [
      ratingKey ? `ratingKey=${ratingKey}` : null,
      guid ? `guid=${truncate(guid, 120)}` : null,
      typeof viewOffset === 'number' ? `viewOffsetMs=${viewOffset}` : null,
      typeof duration === 'number' ? `durationMs=${duration}` : null,
    ]
      .filter(Boolean)
      .join(' ');

    const tail = [
      ids ? ` ${ids}` : '',
      fileSummary,
      src,
      ` persisted=${JSON.stringify(params.persistedPath)}`,
    ].join('');

    // Avoid spamming info logs for chatty events; keep it readable on /logs.
    const eventLower = plexEvent.toLowerCase();
    const level: 'debug' | 'info' =
      eventLower === 'media.scrobble' || eventLower === 'library.new'
        ? 'info'
        : 'debug';

    const msg = `${base}${meta}${tail}`.trim();
    if (level === 'info') this.logger.log(msg);
    else this.logger.debug(msg);
  }

  logPlexWebhookAutomation(params: {
    plexEvent: string;
    mediaType: string;
    seedTitle?: string;
    runs?: Record<string, string>;
    skipped?: Record<string, string>;
    errors?: Record<string, string>;
  }) {
    const ev = (params.plexEvent || '').trim() || '(unknown)';
    const type = (params.mediaType || '').trim();
    const seed = (params.seedTitle || '').trim();
    const runs = params.runs ?? {};
    const skipped = params.skipped ?? {};
    const errors = params.errors ?? {};

    const parts: string[] = [];
    parts.push(`Plex automation: ${ev}${type ? ` type=${type}` : ''}`);
    if (seed) parts.push(`seed=${JSON.stringify(truncate(seed, 80))}`);
    if (Object.keys(runs).length) {
      parts.push(
        `runs=${JSON.stringify(runs)}`,
      );
    }
    if (Object.keys(skipped).length) {
      parts.push(`skipped=${JSON.stringify(skipped)}`);
    }
    if (Object.keys(errors).length) {
      parts.push(`errors=${JSON.stringify(errors)}`);
    }

    const msg = parts.join(' ');
    if (Object.keys(errors).length) this.logger.warn(msg);
    else this.logger.log(msg);
  }

  private getDataDir(): string {
    // During dev, npm workspaces runs scripts with cwd = apps/server.
    // This resolves to the repo-root `data/` directory without relying on cwd.
    const repoRoot = join(__dirname, '..', '..', '..', '..');
    return process.env.APP_DATA_DIR ?? join(repoRoot, 'data');
  }
}
