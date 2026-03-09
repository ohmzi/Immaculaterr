import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';

describe('security/auth credential envelope policy', () => {
  it('requires timestamp and nonce when decrypting auth credential envelopes', () => {
    const credentialEnvelope = {
      decryptPayload: jest.fn().mockReturnValue({
        username: 'admin',
        password: 'secret',
      }),
    };
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      credentialEnvelope as never,
      {} as never,
    );

    service.decryptCredentialEnvelopePayload({ ciphertext: 'x' });
    expect(credentialEnvelope.decryptPayload).toHaveBeenCalledWith(
      { ciphertext: 'x' },
      expect.objectContaining({
        requireTimestamp: true,
        requireNonce: true,
      }),
    );
  });

  it('rejects non-object credential envelopes', () => {
    const service = new AuthService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect(() => service.decryptCredentialEnvelopePayload(null)).toThrow(
      BadRequestException,
    );
  });
});
