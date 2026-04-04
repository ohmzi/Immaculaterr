import { Allow, IsArray, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @Allow()
  credentialEnvelope?: unknown;

  @IsOptional()
  @IsString()
  captchaToken?: string;

  @IsOptional()
  @IsArray()
  recoveryAnswers?: unknown[];
}

export class LoginChallengeDto {
  @IsOptional()
  @IsString()
  username?: string;
}

export class LoginProofDto {
  @IsOptional()
  @IsString()
  challengeId?: string;

  @IsOptional()
  @IsString()
  proof?: string;

  @IsOptional()
  @IsString()
  captchaToken?: string;
}

export class ChangePasswordDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsOptional()
  @IsString()
  newPassword?: string;

  @IsOptional()
  @IsString()
  captchaToken?: string;
}

export class ConfigureRecoveryDto {
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsOptional()
  @IsArray()
  recoveryAnswers?: unknown[];

  @IsOptional()
  @Allow()
  credentialEnvelope?: unknown;
}

export class ResetQuestionsDto {
  @IsOptional()
  @IsString()
  username?: string;
}

export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  challengeId?: string;

  @IsOptional()
  @IsString()
  newPassword?: string;

  @IsOptional()
  @IsArray()
  answers?: unknown[];

  @IsOptional()
  @Allow()
  credentialEnvelope?: unknown;
}
