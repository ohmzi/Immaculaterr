import type { Request } from 'express';
export type AuthUser = {
    id: string;
    username: string;
};
export type AuthenticatedRequest = Request & {
    user: AuthUser;
};
