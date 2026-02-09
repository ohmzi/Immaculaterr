import { ConsoleLogger } from '@nestjs/common';
export declare class BufferedLogger extends ConsoleLogger {
    log(message: unknown, context?: string): void;
    warn(message: unknown, context?: string): void;
    error(message: unknown, stack?: string, context?: string): void;
    debug(message: unknown, context?: string): void;
    verbose(message: unknown, context?: string): void;
}
