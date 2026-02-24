import { PasswordProofService } from '../../auth/password-proof.service';
import {
  createPasswordProofMaterial,
  derivePasswordProofKey,
} from '../../auth/password';

describe('security/password proof challenge', () => {
  it('creates one-time challenges and validates proof signatures', () => {
    const service = new PasswordProofService();

    const password = 'VeryStrongPassword123!';
    const material = createPasswordProofMaterial(password);

    const challenge = service.createChallenge({
      username: 'admin',
      userId: 'u1',
      saltB64: material.saltB64,
      iterations: material.iterations,
    });

    const keyB64 = derivePasswordProofKey({
      password,
      saltB64: challenge.saltB64,
      iterations: challenge.iterations,
    });
    const proof = service.buildExpectedProof({
      keyB64,
      challengeId: challenge.id,
      nonce: challenge.nonce,
    });

    const consumed = service.consumeChallenge(challenge.id);
    expect(consumed?.id).toBe(challenge.id);
    expect(service.matches(proof, proof)).toBe(true);

    // Replay should fail.
    expect(service.consumeChallenge(challenge.id)).toBeNull();
  });
});
