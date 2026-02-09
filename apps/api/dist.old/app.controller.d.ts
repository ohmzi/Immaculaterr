import type { Response } from 'express';
import { AppService } from './app.service';
import { HealthResponseDto } from './app.dto';
export declare class AppController {
    private readonly appService;
    constructor(appService: AppService);
    getHealth(): HealthResponseDto;
    getMeta(): import("./app.meta").AppMeta;
    getReady(res: Response): Promise<import("./app.service").ReadinessResponse>;
}
