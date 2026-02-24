import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CredentialEnvelopeService,
  type CredentialEnvelope,
} from '../auth/credential-envelope.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../db/prisma.service';

const SECRET_REF_PREFIX = 'sr1';

function defaultSettingsDoc(): Record<string, unknown> {
  return { onboarding: { completed: false } };
}

export const SERVICE_SECRET_IDS = [
  'plex',
  'radarr',
  'sonarr',
  'tmdb',
  'overseerr',
  'google',
  'openai',
] as const;

export type ServiceSecretId = (typeof SERVICE_SECRET_IDS)[number];

const TRUE_BOOL_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_BOOL_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

const SERVICE_SECRET_PATHS: Record<ServiceSecretId, readonly string[]> = {
  plex: ['plex.token', 'plexToken'],
  radarr: ['radarr.apiKey', 'radarrApiKey'],
  sonarr: ['sonarr.apiKey', 'sonarrApiKey'],
  tmdb: ['tmdb.apiKey', 'tmdbApiKey', 'tmdb.api_key'],
  overseerr: ['overseerr.apiKey', 'overseerrApiKey'],
  google: ['google.apiKey', 'googleApiKey'],
  openai: ['openai.apiKey', 'openAiApiKey'],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  return asString(pick(obj, path));
}

function parseBoolEnv(raw: string | undefined, fallback: boolean): boolean {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (TRUE_BOOL_ENV_VALUES.has(normalized)) return true;
  if (FALSE_BOOL_ENV_VALUES.has(normalized)) return false;
  return fallback;
}

function countProvidedSecretModes(flags: readonly boolean[]): number {
  let count = 0;
  for (const flag of flags) {
    if (flag) count += 1;
  }
  return count;
}

function assertSingleSecretSource(flags: readonly boolean[]): void {
  if (countProvidedSecretModes(flags) <= 1) return;
  throw new BadRequestException(
    'Provide only one secret source: envelope, secretRef, or plaintext.',
  );
}

function assertEnvelopeObject(value: unknown): CredentialEnvelope {
  if (!isPlainObject(value)) {
    throw new BadRequestException('credentialEnvelope must be an object');
  }
  return value as CredentialEnvelope;
}

type SecretField = 'apiKey' | 'token';

type ResolvedSecretSource = 'none' | 'envelope' | 'secretRef' | 'plaintext';

type SelectedSecretSource =
  | { source: 'none' }
  | { source: 'envelope' }
  | { source: 'secretRef'; secretRef: string }
  | { source: 'plaintext'; plaintext: string };

type ParsedSecretRef = {
  service: ServiceSecretId;
  fingerprint: string;
  signature?: string;
};

function selectSecretSource(params: {
  envelope: unknown;
  secretRef: unknown;
  plaintext: unknown;
}): SelectedSecretSource {
  const envelopeProvided = params.envelope !== undefined && params.envelope !== null;
  const secretRef = asString(params.secretRef);
  const plaintext = asString(params.plaintext);
  assertSingleSecretSource([
    envelopeProvided,
    secretRef.length > 0,
    plaintext.length > 0,
  ]);
  if (envelopeProvided) return { source: 'envelope' };
  if (secretRef) return { source: 'secretRef', secretRef };
  if (plaintext) return { source: 'plaintext', plaintext };
  return { source: 'none' };
}

function assertEnvelopeService(
  payload: Record<string, unknown>,
  expectedService: ServiceSecretId,
): void {
  const payloadService = asString(payload['service']).toLowerCase();
  if (payloadService && payloadService !== expectedService) {
    throw new BadRequestException('credentialEnvelope service is invalid');
  }
}

function readSecretFromEnvelopePayload(
  payload: Record<string, unknown>,
  secretField: SecretField,
): string {
  let secret = asString(payload[secretField]);
  if (!secret && isPlainObject(payload['secret'])) {
    secret = asString(payload['secret'][secretField]);
  }
  if (secret) return secret;

  throw new BadRequestException(
    `credentialEnvelope payload must include ${secretField}`,
  );
}

function assertSecretRefServiceMatch(
  actualService: ServiceSecretId,
  expectedService: ServiceSecretId,
): void {
  if (actualService !== expectedService) {
    throw new BadRequestException('secretRef service mismatch');
  }
}

function assertSecretRefResolved(secret: string): void {
  if (secret) return;
  throw new BadRequestException('secretRef could not be resolved');
}

function parseSecretRef(secretRef: string): ParsedSecretRef {
  const { serviceRaw, fingerprint, signature } = parseSecretRefParts(secretRef);
  return {
    service: decodeSecretRefService(serviceRaw),
    fingerprint,
    signature,
  };
}

function parseSecretRefParts(secretRef: string): {
  serviceRaw: string;
  fingerprint: string;
  signature?: string;
} {
  const parts = parseSecretRefSegments(secretRef);
  const signatureIncluded = parts.length === 4;
  const serviceRaw = parts[1] ?? '';
  const fingerprint = parts[2] ?? '';
  const signature = signatureIncluded ? parts[3] : undefined;
  if (!isValidSecretRefData(serviceRaw, fingerprint, signatureIncluded, signature)) {
    throw new BadRequestException('secretRef is invalid');
  }

  return { serviceRaw, fingerprint, signature };
}

function parseSecretRefSegments(secretRef: string): string[] {
  const parts = secretRef.trim().split('.');
  const hasValidPartCount = parts.length === 3 || parts.length === 4;
  if (hasValidPartCount && parts[0] === SECRET_REF_PREFIX) return parts;
  throw new BadRequestException('secretRef is invalid');
}

function isValidSecretRefData(
  serviceRaw: string,
  fingerprint: string,
  signatureIncluded: boolean,
  signature: string | undefined,
): boolean {
  if (!serviceRaw || !fingerprint) return false;
  if (!signatureIncluded) return true;
  return Boolean(signature);
}

function decodeSecretRefService(serviceRaw: string): ServiceSecretId {
  let decodedService = '';
  try {
    decodedService = Buffer.from(serviceRaw, 'base64url')
      .toString('utf8')
      .trim()
      .toLowerCase();
  } catch {
    throw new BadRequestException('secretRef is invalid');
  }

  if (SERVICE_SECRET_IDS.includes(decodedService as ServiceSecretId)) {
    return decodedService as ServiceSecretId;
  }
  throw new BadRequestException('secretRef service is invalid');
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    // Prevent prototype pollution by blocking dangerous keys.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    if (value === undefined) continue;
    if (value === null) {
      target[key] = null;
      continue;
    }
    if (isPlainObject(value) && isPlainObject(target[key])) {
      target[key] = deepMerge(target[key], value);
      continue;
    }
    target[key] = value;
  }
  return target;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly allowPlaintextSecretsTransport = parseBoolEnv(
    process.env.SECRETS_TRANSPORT_ALLOW_PLAINTEXT,
    false,
  );
  private readonly serviceSecretPaths = SERVICE_SECRET_PATHS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly credentialEnvelope: CredentialEnvelopeService,
  ) {}

  isPlaintextSecretTransportAllowed() {
    return this.allowPlaintextSecretsTransport;
  }

  assertPlaintextSecretTransportAllowed() {
    if (this.allowPlaintextSecretsTransport) return;
    throw new BadRequestException(
      'Plaintext secret transport is disabled; use encrypted envelope payloads.',
    );
  }

  getSecretsEnvelopeKey() {
    return this.credentialEnvelope.getEnvelopeKey();
  }

  async getPublicSettings(userId: string) {
    const settings = await this.getSettingsDoc(userId);
    const secrets = await this.getSecretsDoc(userId);
    const secretsPresent = Object.fromEntries(
      SERVICE_SECRET_IDS.map((service) => [
        service,
        Boolean(this.readServiceSecret(service, secrets)),
      ]),
    );
    const secretRefs = this.createSecretRefs(secrets);

    return {
      settings,
      secretsPresent,
      secretRefs,
      meta: {
        dataDir: process.env.APP_DATA_DIR ?? null,
      },
    };
  }

  /**
   * Internal-only: returns decrypted secrets for server-side job execution.
   * Do NOT expose this response directly to the browser.
   */
  async getInternalSettings(userId: string) {
    return {
      settings: await this.getSettingsDoc(userId),
      secrets: await this.getSecretsDoc(userId),
    };
  }

  async updateSettings(userId: string, patch: Record<string, unknown>) {
    const current = await this.getSettingsDoc(userId);
    const next = deepMerge({ ...current }, patch);
    await this.prisma.userSettings.upsert({
      where: { userId },
      update: { value: JSON.stringify(next) },
      create: { userId, value: JSON.stringify(next) },
    });
    this.logger.log(`Updated settings userId=${userId}`);
    return next;
  }

  async updateSecrets(userId: string, patch: Record<string, unknown>) {
    const current = await this.getSecretsDoc(userId);
    const merged = deepMerge({ ...current }, patch);
    const normalized = Object.fromEntries(
      Object.entries(merged).filter((entry) => entry[1] !== null),
    );

    const encrypted = this.crypto.encryptString(JSON.stringify(normalized));
    await this.prisma.userSecrets.upsert({
      where: { userId },
      update: { value: encrypted },
      create: { userId, value: encrypted },
    });
    this.logger.log(`Updated secrets userId=${userId}`);
    return Object.fromEntries(Object.keys(normalized).map((key) => [key, true]));
  }

  async updateSecretsFromEnvelope(userId: string, envelope: unknown) {
    const payload = this.credentialEnvelope.decryptPayload(
      assertEnvelopeObject(envelope),
      {
        expectedPurpose: 'settings.secrets',
        requireTimestamp: true,
        requireNonce: true,
      },
    );
    const secretsPatch = payload['secrets'];
    if (!isPlainObject(secretsPatch)) {
      throw new BadRequestException(
        'credentialEnvelope payload must include a secrets object',
      );
    }
    return await this.updateSecrets(userId, secretsPatch);
  }

  async resolveServiceSecretInput(params: {
    userId: string;
    service: ServiceSecretId;
    secretField: SecretField;
    expectedPurpose: string;
    envelope?: unknown;
    secretRef?: unknown;
    plaintext?: unknown;
    currentSecrets?: Record<string, unknown>;
  }): Promise<{ value: string; source: ResolvedSecretSource }> {
    const selectedSource = selectSecretSource({
      envelope: params.envelope,
      secretRef: params.secretRef,
      plaintext: params.plaintext,
    });

    switch (selectedSource.source) {
      case 'envelope':
        return this.resolveEnvelopeSecretInput({
          envelope: params.envelope,
          service: params.service,
          secretField: params.secretField,
          expectedPurpose: params.expectedPurpose,
        });
      case 'secretRef':
        return await this.resolveSecretRefInput({
          userId: params.userId,
          service: params.service,
          secretRef: selectedSource.secretRef,
          currentSecrets: params.currentSecrets,
        });
      case 'plaintext':
        return this.resolvePlaintextSecretInput(selectedSource.plaintext);
      default:
        return { value: '', source: 'none' };
    }
  }

  private resolveEnvelopeSecretInput(params: {
    envelope: unknown;
    service: ServiceSecretId;
    secretField: SecretField;
    expectedPurpose: string;
  }): { value: string; source: 'envelope' } {
    return {
      value: this.decryptServiceSecretEnvelope(params),
      source: 'envelope',
    };
  }

  private async resolveSecretRefInput(params: {
    userId: string;
    service: ServiceSecretId;
    secretRef: string;
    currentSecrets?: Record<string, unknown>;
  }): Promise<{ value: string; source: 'secretRef' }> {
    return {
      value: await this.resolveServiceSecretRef(params),
      source: 'secretRef',
    };
  }

  private resolvePlaintextSecretInput(
    plaintext: string,
  ): { value: string; source: 'plaintext' } {
    this.assertPlaintextSecretTransportAllowed();
    return { value: plaintext, source: 'plaintext' };
  }

  decryptServiceSecretEnvelope(params: {
    envelope: unknown;
    service: ServiceSecretId;
    secretField: SecretField;
    expectedPurpose: string;
  }): string {
    const payload = this.credentialEnvelope.decryptPayload(
      assertEnvelopeObject(params.envelope),
      {
        expectedPurpose: params.expectedPurpose,
        requireTimestamp: true,
        requireNonce: true,
      },
    );
    assertEnvelopeService(payload, params.service);
    return readSecretFromEnvelopePayload(payload, params.secretField);
  }

  async resolveServiceSecretRef(params: {
    userId: string;
    service: ServiceSecretId;
    secretRef: string;
    currentSecrets?: Record<string, unknown>;
  }): Promise<string> {
    const parsed = parseSecretRef(params.secretRef);
    assertSecretRefServiceMatch(parsed.service, params.service);
    this.assertSecretRefSignature(params.userId, parsed);
    const secrets = params.currentSecrets ?? (await this.getSecretsDoc(params.userId));
    const currentSecret = this.readServiceSecret(parsed.service, secrets);
    assertSecretRefResolved(currentSecret);
    this.assertSecretRefFresh(currentSecret, parsed.fingerprint);
    return currentSecret;
  }

  private assertSecretRefSignature(
    userId: string,
    parsed: ParsedSecretRef,
  ): void {
    if (!parsed.signature) return;

    // Backward compatibility: verify legacy 4-part refs that include a signature.
    const signingInput = `${userId}.${parsed.service}.${parsed.fingerprint}`;
    if (!this.crypto.verifyDetached(signingInput, parsed.signature)) {
      throw new BadRequestException('secretRef signature is invalid');
    }
  }

  private assertSecretRefFresh(secret: string, expectedFingerprint: string): void {
    if (this.secretFingerprint(secret) === expectedFingerprint) return;
    throw new BadRequestException('secretRef is stale');
  }

  readServiceSecret(
    service: ServiceSecretId,
    secrets: Record<string, unknown>,
  ): string {
    const paths = this.serviceSecretPaths[service];
    for (const path of paths) {
      const secret = pickString(secrets, path);
      if (secret) return secret;
    }
    return '';
  }

  /**
   * Enforce cross-setting constraints that impact background automation.
   *
   * Current rules:
   * - If BOTH Radarr and Sonarr are disabled/unconfigured, auto-run schedules for ARR-dependent jobs
   *   are force-disabled (even if they were previously enabled).
   */
  async enforceAutomationConstraints(userId: string) {
    const settings = await this.getSettingsDoc(userId);
    const secrets = await this.getSecretsDoc(userId);

    const readBool = (obj: Record<string, unknown>, path: string): boolean | null => {
      const parts = path.split('.');
      let cur: unknown = obj;
      for (const p of parts) {
        if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
        cur = (cur as Record<string, unknown>)[p];
      }
      return typeof cur === 'boolean' ? cur : null;
    };

    const radarrEnabledSetting = readBool(settings, 'radarr.enabled');
    const sonarrEnabledSetting = readBool(settings, 'sonarr.enabled');

    const radarrSecretsPresent = Boolean(secrets['radarr']);
    const sonarrSecretsPresent = Boolean(secrets['sonarr']);

    // Match the web UI's semantics:
    // - if enabled flag exists, it wins
    // - otherwise, presence of secrets implies enabled
    const radarrEnabled = (radarrEnabledSetting ?? radarrSecretsPresent) === true;
    const sonarrEnabled = (sonarrEnabledSetting ?? sonarrSecretsPresent) === true;

    if (radarrEnabled || sonarrEnabled) return;

    const res = await this.prisma.jobSchedule.updateMany({
      where: {
        jobId: { in: ['monitorConfirm', 'arrMonitoredSearch'] },
        enabled: true,
      },
      data: { enabled: false },
    });

    if (res.count > 0) {
      this.logger.log(
        `Disabled ARR-dependent schedules (Radarr+Sonarr disabled) userId=${userId} count=${res.count}`,
      );
    }
  }

  private async getSettingsDoc(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.prisma.userSettings.findUnique({
      where: { userId },
    });
    if (!row?.value) return defaultSettingsDoc();
    try {
      const parsed = JSON.parse(row.value) as unknown;
      return isPlainObject(parsed) ? parsed : defaultSettingsDoc();
    } catch {
      return defaultSettingsDoc();
    }
  }

  private async getSecretsDoc(
    userId: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.prisma.userSecrets.findUnique({ where: { userId } });
    if (!row?.value) return {};

    try {
      const raw = this.crypto.isEncrypted(row.value)
        ? this.crypto.decryptString(row.value)
        : row.value;
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw) as unknown;
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private createSecretRefs(secrets: Record<string, unknown>): Record<string, string> {
    const refs: Record<string, string> = {};
    for (const service of SERVICE_SECRET_IDS) {
      const secret = this.readServiceSecret(service, secrets);
      if (!secret) continue;
      refs[service] = this.buildSecretRef(service, secret);
    }
    return refs;
  }

  private buildSecretRef(service: ServiceSecretId, secret: string): string {
    const fingerprint = this.secretFingerprint(secret);
    const encodedService = Buffer.from(service, 'utf8').toString('base64url');
    // New refs are 3-part: sr1.<serviceB64>.<fingerprint>
    // Fingerprint is keyed PBKDF2 output, so it cannot be forged without server key material.
    return `${SECRET_REF_PREFIX}.${encodedService}.${fingerprint}`;
  }

  private secretFingerprint(secret: string): string {
    return this.crypto.deriveSecretFingerprint(secret);
  }
}
