import { Injectable } from '@nestjs/common';

function trimOrNull(value: string | null | undefined): string | null {
  const trimmedValue = (value ?? '').trim();
  return trimmedValue ? trimmedValue : null;
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

    try {
      const response = await fetch(this.verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: this.buildVerifyRequestBody(token, params.ip),
      });
      return await this.parseVerifyResponse(response);
    } catch {
      return false;
    }
  }

  private buildVerifyRequestBody(
    token: string,
    ip: string | null,
  ): URLSearchParams {
    const body = new URLSearchParams();
    if (this.secret) body.set('secret', this.secret);
    body.set('response', token);
    const remoteIp = trimOrNull(ip);
    if (remoteIp) body.set('remoteip', remoteIp);
    return body;
  }

  private async parseVerifyResponse(response: Response): Promise<boolean> {
    if (!response.ok) return false;
    const json = (await response.json().catch(() => null)) as unknown;
    if (!json || typeof json !== 'object') return false;
    const success = (json as Record<string, unknown>)['success'];
    return success === true;
  }
}
