import type { NextFunction, Request, Response } from 'express';
export type IpRateLimitOptions = {
    windowMs: number;
    max: number;
    keyPrefix?: string;
    methods?: string[];
};
export declare function createIpRateLimitMiddleware(options: IpRateLimitOptions): (req: Request, res: Response, next: NextFunction) => void;
