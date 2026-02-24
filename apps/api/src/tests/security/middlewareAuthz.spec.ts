import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';

function makeContext(req: Record<string, unknown>): ExecutionContext {
  return {
    getClass: () => class TestClass {},
    getHandler: () => function testHandler() {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('security/middleware authz default deny', () => {
  it('denies non-public endpoints without a session', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const authService = {
      readSessionIdFromRequest: jest.fn().mockReturnValue(null),
      getUserForSession: jest.fn(),
    };

    const guard = new AuthGuard(reflector, authService as never);
    await expect(guard.canActivate(makeContext({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows explicitly public endpoints', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const authService = {
      readSessionIdFromRequest: jest.fn(),
      getUserForSession: jest.fn(),
    };

    const guard = new AuthGuard(reflector, authService as never);
    await expect(guard.canActivate(makeContext({}))).resolves.toBe(true);
  });

  it('attaches user for valid session', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const authService = {
      readSessionIdFromRequest: jest.fn().mockReturnValue('sid'),
      getUserForSession: jest
        .fn()
        .mockResolvedValue({ id: 'u1', username: 'admin' }),
    };

    const req: Record<string, unknown> = {};
    const guard = new AuthGuard(reflector, authService as never);
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(req['user']).toEqual({ id: 'u1', username: 'admin' });
  });
});
