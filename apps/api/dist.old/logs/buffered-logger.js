"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BufferedLogger = void 0;
const common_1 = require("@nestjs/common");
const server_logs_store_1 = require("./server-logs.store");
class BufferedLogger extends common_1.ConsoleLogger {
    log(message, context) {
        super.log(message, context);
        (0, server_logs_store_1.addServerLog)({ level: 'info', message, context });
    }
    warn(message, context) {
        super.warn(message, context);
        (0, server_logs_store_1.addServerLog)({ level: 'warn', message, context });
    }
    error(message, stack, context) {
        super.error(message, stack, context);
        (0, server_logs_store_1.addServerLog)({ level: 'error', message, stack, context });
    }
    debug(message, context) {
        super.debug(message, context);
        (0, server_logs_store_1.addServerLog)({ level: 'debug', message, context });
    }
    verbose(message, context) {
        super.verbose(message, context);
        (0, server_logs_store_1.addServerLog)({ level: 'debug', message, context });
    }
}
exports.BufferedLogger = BufferedLogger;
//# sourceMappingURL=buffered-logger.js.map