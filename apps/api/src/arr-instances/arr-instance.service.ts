import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ArrInstance as ArrInstanceRow } from '@prisma/client';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../db/prisma.service';
import { SettingsService } from '../settings/settings.service';

export type ArrInstanceType = 'radarr' | 'sonarr';

export type ArrInstanceView = {
  id: string;
  type: ArrInstanceType;
  name: string;
  isPrimary: boolean;
  enabled: boolean;
  baseUrl: string;
  rootFolderPath: string | null;
  qualityProfileId: number | null;
  tagId: number | null;
  sortOrder: number;
  apiKeySet: boolean;
};

export type ArrResolvedInstance = {
  id: string;
  type: ArrInstanceType;
  name: string;
  isPrimary: boolean;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  rootFolderPath: string | null;
  qualityProfileId: number | null;
  tagId: number | null;
};

type ArrCreateInput = {
  type: ArrInstanceType;
  name?: string;
  baseUrl: string;
  apiKey: string;
  enabled?: boolean;
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  tagId?: number | null;
};

type ArrUpdateInput = {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  rootFolderPath?: string | null;
  qualityProfileId?: number | null;
  tagId?: number | null;
  sortOrder?: number;
};

type PrimaryInstanceSeed = {
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  name: string;
  rootFolderPath: string | null;
  qualityProfileId: number | null;
  tagId: number | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, part)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string {
  const value = pick(obj, path);
  return typeof value === 'string' ? value.trim() : '';
}

function pickBool(obj: Record<string, unknown>, path: string): boolean | null {
  const value = pick(obj, path);
  return typeof value === 'boolean' ? value : null;
}

function pickNumber(obj: Record<string, unknown>, path: string): number | null {
  const value = pick(obj, path);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isDisallowedMetadataHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === '169.254.169.254' ||
    normalized === 'metadata.google.internal' ||
    normalized === 'metadata.azure.internal'
  );
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new BadRequestException('baseUrl is required');
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new BadRequestException('baseUrl must be a valid http(s) URL');
  }
  if (isDisallowedMetadataHostname(parsed.hostname)) {
    throw new BadRequestException('baseUrl host is not allowed');
  }
  const out = parsed.toString();
  return out.endsWith('/') ? out.slice(0, -1) : out;
}

function asOptionalString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asOptionalPositiveInt(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
  }
  return null;
}

function asArrType(value: string): ArrInstanceType {
  const lowered = value.trim().toLowerCase();
  if (lowered === 'radarr' || lowered === 'sonarr') return lowered;
  throw new BadRequestException('type must be "radarr" or "sonarr"');
}

@Injectable()
export class ArrInstanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly crypto: CryptoService,
  ) {}

  primaryIdFor(type: ArrInstanceType): string {
    return `primary-${type}`;
  }

  isPrimaryIdForType(type: ArrInstanceType, id: string): boolean {
    const normalized = id.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'primary') return true;
    return normalized === this.primaryIdFor(type);
  }

  async inferTypeForInstanceId(
    userId: string,
    id: string,
  ): Promise<ArrInstanceType | null> {
    const normalized = id.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === this.primaryIdFor('radarr')) return 'radarr';
    if (normalized === this.primaryIdFor('sonarr')) return 'sonarr';
    const row = await this.prisma.arrInstance.findFirst({
      where: { userId, id: id.trim() },
      select: { type: true },
    });
    if (!row) return null;
    return asArrType(row.type);
  }

  async list(userId: string, typeRaw?: string): Promise<ArrInstanceView[]> {
    const type = typeRaw ? asArrType(typeRaw) : null;
    const types: ArrInstanceType[] = type ? [type] : ['radarr', 'sonarr'];
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const dbRows = await this.prisma.arrInstance.findMany({
      where: {
        userId,
        ...(type ? { type } : {}),
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const byType = new Map<ArrInstanceType, ArrInstanceRow[]>();
    for (const t of types) byType.set(t, []);
    for (const row of dbRows) {
      const rowType = asArrType(row.type);
      const list = byType.get(rowType) ?? [];
      list.push(row);
      byType.set(rowType, list);
    }

    const out: ArrInstanceView[] = [];
    for (const t of types) {
      const primary = this.buildPrimaryInstanceSeed({
        type: t,
        settings,
        secrets,
      });
      out.push({
        id: this.primaryIdFor(t),
        type: t,
        name: primary.name,
        isPrimary: true,
        enabled: primary.enabled,
        baseUrl: primary.baseUrl,
        rootFolderPath: primary.rootFolderPath,
        qualityProfileId: primary.qualityProfileId,
        tagId: primary.tagId,
        sortOrder: 0,
        apiKeySet: Boolean(primary.apiKey),
      });
      for (const row of byType.get(t) ?? []) {
        out.push(this.toView(row));
      }
    }
    return out;
  }

  async create(userId: string, input: ArrCreateInput): Promise<ArrInstanceView> {
    const type = asArrType(input.type);
    const baseUrl = normalizeHttpUrl(input.baseUrl);
    const apiKey = input.apiKey.trim();
    if (!apiKey) throw new BadRequestException('apiKey is required');
    const existingRows = await this.prisma.arrInstance.findMany({
      where: { userId, type },
      select: { id: true, name: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const { settings, secrets } =
      await this.settingsService.getInternalSettings(userId);
    const primary = this.buildPrimaryInstanceSeed({ type, settings, secrets });
    const requestedName = (input.name ?? '').trim();
    const name =
      requestedName ||
      this.buildAutoName(type, [
        primary.name,
        ...existingRows.map((row) => row.name),
      ]);
    this.assertUniqueName(name, [primary.name, ...existingRows.map((row) => row.name)]);
    const maxSortOrder =
      existingRows.reduce((max, row) => Math.max(max, row.sortOrder), 0) || 0;
    const created = await this.prisma.arrInstance.create({
      data: {
        userId,
        type,
        name,
        baseUrl,
        apiKey: this.crypto.encryptString(apiKey),
        enabled: input.enabled ?? true,
        sortOrder: maxSortOrder + 1,
        rootFolderPath: asOptionalString(input.rootFolderPath ?? null),
        qualityProfileId: asOptionalPositiveInt(input.qualityProfileId ?? null),
        tagId: asOptionalPositiveInt(input.tagId ?? null),
      },
    });
    return this.toView(created);
  }

  async update(
    userId: string,
    id: string,
    patch: ArrUpdateInput,
  ): Promise<ArrInstanceView> {
    const current = await this.getOwnedDbInstance(userId, id);
    const type = asArrType(current.type);
    const data: Partial<ArrInstanceRow> = {};

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      const siblings = await this.prisma.arrInstance.findMany({
        where: { userId, type, id: { not: current.id } },
        select: { name: true },
      });
      const { settings, secrets } =
        await this.settingsService.getInternalSettings(userId);
      const primary = this.buildPrimaryInstanceSeed({ type, settings, secrets });
      this.assertUniqueName(name, [primary.name, ...siblings.map((row) => row.name)]);
      data.name = name;
    }

    if (patch.baseUrl !== undefined) {
      data.baseUrl = normalizeHttpUrl(patch.baseUrl);
    }
    if (patch.apiKey !== undefined) {
      const apiKey = patch.apiKey.trim();
      if (!apiKey) throw new BadRequestException('apiKey cannot be empty');
      data.apiKey = this.crypto.encryptString(apiKey);
    }
    if (patch.enabled !== undefined) data.enabled = patch.enabled === true;
    if (patch.sortOrder !== undefined) {
      const sortOrder = Math.max(0, Math.trunc(patch.sortOrder));
      data.sortOrder = sortOrder;
    }
    if (patch.rootFolderPath !== undefined) {
      data.rootFolderPath = asOptionalString(patch.rootFolderPath);
    }
    if (patch.qualityProfileId !== undefined) {
      data.qualityProfileId = asOptionalPositiveInt(patch.qualityProfileId);
    }
    if (patch.tagId !== undefined) {
      data.tagId = asOptionalPositiveInt(patch.tagId);
    }

    if (!Object.keys(data).length) return this.toView(current);
    const updated = await this.prisma.arrInstance.update({
      where: { id: current.id },
      data,
    });
    return this.toView(updated);
  }

  async delete(userId: string, id: string): Promise<void> {
    if (
      this.isPrimaryIdForType('radarr', id) ||
      this.isPrimaryIdForType('sonarr', id)
    ) {
      throw new BadRequestException('Cannot delete primary instance');
    }
    const current = await this.getOwnedDbInstance(userId, id);
    const type = asArrType(current.type);
    await this.prisma.$transaction(async (tx) => {
      await tx.arrInstance.delete({ where: { id: current.id } });
      if (type === 'radarr') {
        await tx.immaculateTasteProfile.updateMany({
          where: { userId, radarrInstanceId: current.id },
          data: { radarrInstanceId: null },
        });
      } else {
        await tx.immaculateTasteProfile.updateMany({
          where: { userId, sonarrInstanceId: current.id },
          data: { sonarrInstanceId: null },
        });
      }
    });
  }

  async resolveInstance(
    userId: string,
    typeRaw: string,
    instanceId?: string | null,
    options?: { requireEnabled?: boolean; requireConfigured?: boolean },
  ): Promise<ArrResolvedInstance> {
    const type = asArrType(typeRaw);
    const requireEnabled = options?.requireEnabled ?? false;
    const requireConfigured = options?.requireConfigured ?? true;
    const normalizedId = (instanceId ?? '').trim();
    if (!normalizedId || this.isPrimaryIdForType(type, normalizedId)) {
      const { settings, secrets } =
        await this.settingsService.getInternalSettings(userId);
      const primary = this.buildPrimaryInstanceSeed({ type, settings, secrets });
      const resolved: ArrResolvedInstance = {
        id: this.primaryIdFor(type),
        type,
        name: primary.name,
        isPrimary: true,
        enabled: primary.enabled,
        baseUrl: primary.baseUrl,
        apiKey: primary.apiKey,
        rootFolderPath: primary.rootFolderPath,
        qualityProfileId: primary.qualityProfileId,
        tagId: primary.tagId,
      };
      this.assertResolvedInstance(
        resolved,
        type,
        requireEnabled,
        requireConfigured,
      );
      return resolved;
    }

    const row = await this.prisma.arrInstance.findFirst({
      where: { userId, id: normalizedId, type },
    });
    if (!row) throw new NotFoundException('ARR instance not found');
    const resolved: ArrResolvedInstance = {
      id: row.id,
      type,
      name: row.name,
      isPrimary: false,
      enabled: row.enabled,
      baseUrl: row.baseUrl,
      apiKey: this.decryptApiKey(row.apiKey),
      rootFolderPath: row.rootFolderPath,
      qualityProfileId: row.qualityProfileId,
      tagId: row.tagId,
    };
    this.assertResolvedInstance(resolved, type, requireEnabled, requireConfigured);
    return resolved;
  }

  async getOwnedDbInstance(userId: string, id: string): Promise<ArrInstanceRow> {
    const normalizedId = id.trim();
    if (!normalizedId) throw new BadRequestException('id is required');
    if (
      this.isPrimaryIdForType('radarr', normalizedId) ||
      this.isPrimaryIdForType('sonarr', normalizedId)
    ) {
      throw new BadRequestException('Primary instance is virtual');
    }
    const row = await this.prisma.arrInstance.findFirst({
      where: { userId, id: normalizedId },
    });
    if (!row) throw new NotFoundException('ARR instance not found');
    return row;
  }

  private toView(row: ArrInstanceRow): ArrInstanceView {
    return {
      id: row.id,
      type: asArrType(row.type),
      name: row.name,
      isPrimary: false,
      enabled: row.enabled,
      baseUrl: row.baseUrl,
      rootFolderPath: row.rootFolderPath,
      qualityProfileId: row.qualityProfileId,
      tagId: row.tagId,
      sortOrder: row.sortOrder,
      apiKeySet: Boolean(this.decryptApiKey(row.apiKey)),
    };
  }

  private decryptApiKey(value: string): string {
    const raw = value.trim();
    if (!raw) return '';
    try {
      return this.crypto.isEncrypted(raw) ? this.crypto.decryptString(raw) : raw;
    } catch {
      return '';
    }
  }

  private assertResolvedInstance(
    instance: ArrResolvedInstance,
    type: ArrInstanceType,
    requireEnabled: boolean,
    requireConfigured: boolean,
  ) {
    if (requireEnabled && !instance.enabled) {
      throw new BadRequestException(
        `${type} instance "${instance.name}" is disabled`,
      );
    }
    if (requireConfigured && (!instance.baseUrl || !instance.apiKey)) {
      throw new BadRequestException(
        `${type} instance "${instance.name}" is not configured`,
      );
    }
  }

  private buildPrimaryInstanceSeed(params: {
    type: ArrInstanceType;
    settings: Record<string, unknown>;
    secrets: Record<string, unknown>;
  }): PrimaryInstanceSeed {
    const type = params.type;
    const title = type === 'radarr' ? 'Radarr' : 'Sonarr';
    const baseUrl = pickString(params.settings, `${type}.baseUrl`);
    const apiKey = this.settingsService.readServiceSecret(type, params.secrets);
    const enabledFlag = pickBool(params.settings, `${type}.enabled`);
    const enabled = (enabledFlag ?? Boolean(apiKey)) && Boolean(baseUrl) && Boolean(apiKey);
    const displayName = pickString(params.settings, `${type}.displayName`) || title;
    const rootFolderPath =
      pickString(params.settings, `${type}.defaultRootFolderPath`) ||
      pickString(params.settings, `${type}.rootFolderPath`) ||
      null;
    const qualityProfileId = (() => {
      const value =
        pickNumber(params.settings, `${type}.defaultQualityProfileId`) ??
        pickNumber(params.settings, `${type}.qualityProfileId`);
      if (value === null) return null;
      return value > 0 ? Math.trunc(value) : null;
    })();
    const tagId = (() => {
      const value =
        pickNumber(params.settings, `${type}.defaultTagId`) ??
        pickNumber(params.settings, `${type}.tagId`);
      if (value === null) return null;
      return value > 0 ? Math.trunc(value) : null;
    })();
    return {
      baseUrl,
      apiKey,
      enabled,
      name: displayName,
      rootFolderPath,
      qualityProfileId,
      tagId,
    };
  }

  private assertUniqueName(name: string, existingNames: string[]) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) throw new BadRequestException('name is required');
    const conflicts = new Set(
      existingNames.map((v) => v.trim().toLowerCase()).filter(Boolean),
    );
    if (conflicts.has(normalized)) {
      throw new BadRequestException(`Instance name "${name}" already exists`);
    }
  }

  private buildAutoName(type: ArrInstanceType, existingNames: string[]): string {
    const base = type === 'radarr' ? 'Radarr' : 'Sonarr';
    const normalized = new Set(
      existingNames.map((value) => value.trim().toLowerCase()).filter(Boolean),
    );
    let suffix = 2;
    while (suffix < 10_000) {
      const candidate = `${base}-${suffix}`;
      if (!normalized.has(candidate.toLowerCase())) return candidate;
      suffix += 1;
    }
    return `${base}-${Date.now()}`;
  }
}
