import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
type BootstrapResponse = {
    needsAdminSetup: boolean;
    onboardingComplete: boolean;
};
type RegisterBody = {
    username?: unknown;
    password?: unknown;
};
type LoginBody = {
    username?: unknown;
    password?: unknown;
};
export declare class AuthController {
    private readonly authService;
    private readonly logger;
    constructor(authService: AuthService);
    bootstrap(): Promise<BootstrapResponse>;
    register(body: RegisterBody, req: Request, res: Response): Promise<{
        ok: boolean;
        user: {
            id: any;
            username: any;
        };
    }>;
    login(body: LoginBody, req: Request, res: Response): Promise<{
        ok: boolean;
        user: {
            id: any;
            username: any;
        };
    }>;
    logout(req: Request, res: Response): Promise<{
        ok: boolean;
    }>;
    me(req: AuthenticatedRequest): {
        user: import("./auth.types").AuthUser;
    };
    resetDev(req: Request, res: Response): Promise<{
        ok: boolean;
    }>;
    private setSessionCookie;
    private clearSessionCookie;
    private getSessionCookieOptions;
}
export {};
