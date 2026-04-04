import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { PlexServerService } from '../plex/plex-server.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthThrottleService } from './auth-throttle.service';
import { CaptchaService } from './captcha.service';
import { CredentialEnvelopeService } from './credential-envelope.service';
import { PasswordProofService } from './password-proof.service';
import { SessionCleanupService } from './session-cleanup.service';
import { SessionRollingInterceptor } from './session-rolling.interceptor';

@Module({
  imports: [DbModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    AuthThrottleService,
    CaptchaService,
    CredentialEnvelopeService,
    PasswordProofService,
    PlexServerService,
    SessionCleanupService,
    SessionRollingInterceptor,
  ],
  exports: [
    AuthService,
    AuthGuard,
    CredentialEnvelopeService,
    SessionRollingInterceptor,
  ],
})
export class AuthModule {}
