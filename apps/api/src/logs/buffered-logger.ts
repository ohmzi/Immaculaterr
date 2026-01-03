import { ConsoleLogger } from '@nestjs/common';
import { addServerLog } from './server-logs.store';

export class BufferedLogger extends ConsoleLogger {
  override log(message: unknown, context?: string) {
    super.log(message, context);
    addServerLog({ level: 'info', message });
  }

  override warn(message: unknown, context?: string) {
    super.warn(message, context);
    addServerLog({ level: 'warn', message });
  }

  override error(message: unknown, stack?: string, context?: string) {
    super.error(message, stack, context);
    addServerLog({ level: 'error', message, stack });
  }

  override debug(message: unknown, context?: string) {
    super.debug(message, context);
    addServerLog({ level: 'debug', message });
  }

  override verbose(message: unknown, context?: string) {
    super.verbose(message, context);
    addServerLog({ level: 'debug', message });
  }
}


