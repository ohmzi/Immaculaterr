export type LoginKeyResponse = {
  algorithm: 'RSA-OAEP-256+A256GCM';
  keyId: string;
  publicKeyPem: string;
  ephemeral: boolean;
};

export type EnvelopeKeyResponse = LoginKeyResponse;

export type CredentialEnvelope = {
  algorithm: 'RSA-OAEP-256+A256GCM';
  keyId: string;
  encryptedKey: string;
  iv: string;
  ciphertext: string;
  tag: string;
};

function toBase64Url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToSpkiBytes(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function randomNonceBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function createClientNonce(bytes = 16): string {
  return toBase64Url(randomNonceBytes(bytes));
}

async function encryptJsonEnvelope(params: {
  key: EnvelopeKeyResponse;
  payload: Record<string, unknown>;
}): Promise<CredentialEnvelope> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is not available in this browser');

  const publicKey = await subtle.importKey(
    'spki',
    toArrayBuffer(pemToSpkiBytes(params.key.publicKeyPem)),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );

  const aesKey = await subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt'],
  );
  const rawAesKey = new Uint8Array(await subtle.exportKey('raw', aesKey));
  const iv = randomNonceBytes(12);

  const payload = new TextEncoder().encode(
    JSON.stringify(params.payload),
  );

  const encryptedPayload = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(payload),
    ),
  );
  const encryptedKey = new Uint8Array(
    await subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      toArrayBuffer(rawAesKey),
    ),
  );

  const tagLength = 16;
  if (encryptedPayload.length < tagLength) {
    throw new Error('Invalid encrypted payload');
  }
  const ciphertext = encryptedPayload.slice(0, encryptedPayload.length - tagLength);
  const tag = encryptedPayload.slice(encryptedPayload.length - tagLength);

  return {
    algorithm: 'RSA-OAEP-256+A256GCM',
    keyId: params.key.keyId,
    encryptedKey: toBase64Url(encryptedKey),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
    tag: toBase64Url(tag),
  };
}

export async function createPayloadEnvelope(params: {
  key: EnvelopeKeyResponse;
  purpose: string;
  service?: string;
  payload?: Record<string, unknown>;
}): Promise<CredentialEnvelope> {
  const purpose = params.purpose.trim();
  if (!purpose) throw new Error('Envelope purpose is required');

  return await encryptJsonEnvelope({
    key: params.key,
    payload: {
      ...(params.payload ?? {}),
      purpose,
      ...(params.service ? { service: params.service } : {}),
      timestampMs: Date.now(),
      nonce: createClientNonce(),
    },
  });
}

export async function createCredentialEnvelope(params: {
  username: string;
  password: string;
  key: LoginKeyResponse;
}): Promise<CredentialEnvelope> {
  return await createPayloadEnvelope({
    key: params.key,
    purpose: 'auth.login',
    payload: {
      username: params.username,
      password: params.password,
    },
  });
}
