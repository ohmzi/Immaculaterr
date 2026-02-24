import { Injectable } from '@nestjs/common';

function trimOrNull(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v ? v : null;
}

@Injectable()
export class CaptchaService {
  private readonly verifyUrl = trimOrNull(process.env.AUTH_CAPTCHA_VERIFY_URL);
  private readonly secret = trimOrNull(process.env.AUTH_CAPTCHA_SECRET);

  isEnabled(): boolean {
    return (
      process.env.AUTH_CAPTCHA_ENABLED === 'true' || Boolean(this.verifyUrl)
    );
  }

  async verify(params: {
    token: string | null | undefined;
    ip: string | null;
  }): Promise<boolean> {
    const token = trimOrNull(params.token);
    if (!this.isEnabled()) return true;
    if (!token) return false;

    // Hook mode: token presence can satisfy captcha when no verifier URL is configured.
    if (!this.verifyUrl) return true;

    const body = new URLSearchParams();
    if (this.secret) body.set('secret', this.secret);
    body.set('response', token);
    if (params.ip?.trim()) body.set('remoteip', params.ip.trim());

    try {
      const res = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) return false;
      const json = (await res.json().catch(() => null)) as unknown;
      if (!json || typeof json !== 'object') return false;
      const success = (json as Record<string, unknown>)['success'];
      return success === true;
    } catch {
      return false;
    }
  }
}
