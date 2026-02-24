import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthThrottleService } from './auth-throttle.service';
import { CaptchaService } from './captcha.service';
import { CredentialEnvelopeService } from './credential-envelope.service';
import { PasswordProofService } from './password-proof.service';

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
  ],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}
