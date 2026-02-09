import type { NextFunction, Request, Response } from 'express';
export type OriginCheckOptions = {
    allowedOrigins?: string[];
};
export declare function createOriginCheckMiddleware(options?: OriginCheckOptions): (req: Request, res: Response, next: NextFunction) => void;
