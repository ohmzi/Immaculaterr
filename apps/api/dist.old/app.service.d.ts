import type { HealthResponseDto } from './app.dto';
import { PrismaService } from './db/prisma.service';
export type ReadinessCheck = {
    ok: true;
} | {
    ok: false;
    error: string;
};
export type ReadinessResponse = {
    status: 'ready' | 'not_ready';
    time: string;
    checks: {
        db: ReadinessCheck;
        dataDir: ReadinessCheck;
    };
};
export declare class AppService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getHealth(): HealthResponseDto;
    getMeta(): import("./app.meta").AppMeta;
    getReadiness(): Promise<ReadinessResponse>;
}
