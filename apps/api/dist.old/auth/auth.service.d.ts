import type { Request } from 'express';
import { PrismaService } from '../db/prisma.service';
import type { AuthUser } from './auth.types';
export declare class AuthService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    getSessionCookieName(): string;
    readSessionIdFromRequest(req: Request): string | null;
    hasAnyUser(): Promise<boolean>;
    registerAdmin(params: {
        username: string;
        password: string;
    }): Promise<any>;
    login(params: {
        username: string;
        password: string;
    }): Promise<{
        sessionId: string;
        user: {
            id: any;
            username: any;
        };
    }>;
    logout(sessionId: string): Promise<void>;
    getUserForSession(sessionId: string): Promise<AuthUser | null>;
    getFirstAdminUserId(): Promise<string | null>;
    isOnboardingComplete(): Promise<boolean>;
    resetAllData(): Promise<void>;
    private createSessionId;
}
