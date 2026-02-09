"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const app_module_1 = require("./app.module");
const bootstrap_env_1 = require("./bootstrap-env");
const buffered_logger_1 = require("./logs/buffered-logger");
const origin_check_middleware_1 = require("./security/origin-check.middleware");
const ip_rate_limit_middleware_1 = require("./security/ip-rate-limit.middleware");
const security_headers_middleware_1 = require("./security/security-headers.middleware");
const app_meta_1 = require("./app.meta");
function ensureLegacyGlobals() {
    const g = globalThis;
    if (!('alternateFormatName' in g)) {
        g['alternateFormatName'] = '';
        try {
            const evalFn = typeof g['eval'] === 'function' ? g['eval'] : null;
            evalFn?.('var alternateFormatName = ""');
        }
        catch {
        }
    }
}
function parseTrustProxyEnv(raw) {
    const value = raw?.trim();
    if (!value)
        return undefined;
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === 'yes' || lower === 'on')
        return true;
    if (lower === 'false' || lower === 'no' || lower === 'off')
        return false;
    if (/^\d+$/.test(value))
        return Number.parseInt(value, 10);
    return value;
}
async function bootstrap() {
    await (0, bootstrap_env_1.ensureBootstrapEnv)();
    ensureLegacyGlobals();
    const bootstrapLogger = new common_1.Logger('Bootstrap');
    process.on('unhandledRejection', (reason) => {
        bootstrapLogger.error(`Unhandled rejection: ${String(reason)}`);
    });
    process.on('uncaughtException', (err) => {
        bootstrapLogger.error(`Uncaught exception: ${err?.stack ?? String(err)}`);
        process.exit(1);
    });
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: new buffered_logger_1.BufferedLogger(),
    });
    const trustProxy = parseTrustProxyEnv(process.env.TRUST_PROXY) ??
        (process.env.NODE_ENV === 'production' ? 1 : undefined);
    if (trustProxy !== undefined) {
        const httpAdapter = app.getHttpAdapter();
        httpAdapter.getInstance()?.set?.('trust proxy', trustProxy);
    }
    app.use(security_headers_middleware_1.securityHeadersMiddleware);
    app.use((0, cookie_parser_1.default)());
    app.use((req, _res, next) => {
        const url = req.url || '';
        if (/^\/webhooks\/plex(?:\/)?(?:\?|$)/.test(url)) {
            req.url = url.replace(/^\/webhooks\/plex(?:\/)?/, '/api/webhooks/plex');
        }
        next();
    });
    app.setGlobalPrefix('api');
    const corsOrigins = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    if (process.env.NODE_ENV !== 'production') {
        app.enableCors({
            origin: true,
            credentials: true,
        });
    }
    else if (corsOrigins.length > 0) {
        app.enableCors({
            origin: corsOrigins,
            credentials: true,
        });
    }
    app.use('/api', (0, origin_check_middleware_1.createOriginCheckMiddleware)({ allowedOrigins: corsOrigins }));
    const authRateLimitWindowMsRaw = Number.parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? '60000', 10);
    const authRateLimitWindowMs = Number.isFinite(authRateLimitWindowMsRaw) && authRateLimitWindowMsRaw > 0
        ? authRateLimitWindowMsRaw
        : 60_000;
    const authLoginMaxRaw = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX_LOGIN ?? '10', 10);
    const authLoginMax = Number.isFinite(authLoginMaxRaw) && authLoginMaxRaw > 0
        ? authLoginMaxRaw
        : 10;
    const authRegisterMaxRaw = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX_REGISTER ?? '3', 10);
    const authRegisterMax = Number.isFinite(authRegisterMaxRaw) && authRegisterMaxRaw > 0
        ? authRegisterMaxRaw
        : 3;
    app.use('/api/auth/login', (0, ip_rate_limit_middleware_1.createIpRateLimitMiddleware)({
        windowMs: authRateLimitWindowMs,
        max: authLoginMax,
        keyPrefix: 'auth_login',
        methods: ['POST'],
    }));
    app.use('/api/auth/register', (0, ip_rate_limit_middleware_1.createIpRateLimitMiddleware)({
        windowMs: authRateLimitWindowMs,
        max: authRegisterMax,
        keyPrefix: 'auth_register',
        methods: ['POST'],
    }));
    const httpLoggingEnabled = process.env.HTTP_LOGGING === 'true' ||
        process.env.NODE_ENV !== 'production';
    if (httpLoggingEnabled) {
        const httpLogger = new common_1.Logger('HTTP');
        app.use((req, res, next) => {
            const start = process.hrtime.bigint();
            res.on('finish', () => {
                const ms = Number(process.hrtime.bigint() - start) / 1e6;
                const status = res.statusCode;
                const path = req.originalUrl || req.url;
                const msg = `${req.method} ${path} -> ${status} ${ms.toFixed(0)}ms`;
                if (status >= 500)
                    httpLogger.error(msg);
                else if (status >= 400)
                    httpLogger.warn(msg);
                else if (ms >= 1500)
                    httpLogger.warn(`SLOW ${msg}`);
            });
            next();
        });
    }
    const swaggerEnabled = process.env.SWAGGER_ENABLED === 'true' ||
        process.env.NODE_ENV !== 'production';
    if (swaggerEnabled) {
        const meta = (0, app_meta_1.readAppMeta)();
        const config = new swagger_1.DocumentBuilder()
            .setTitle('Immaculaterr API')
            .setDescription('Local API for the Immaculaterr webapp.')
            .setVersion(meta.version)
            .build();
        const document = swagger_1.SwaggerModule.createDocument(app, config);
        swagger_1.SwaggerModule.setup('api/docs', app, document, {
            swaggerOptions: {
                persistAuthorization: true,
            },
        });
    }
    const port = Number.parseInt(process.env.PORT ?? '5454', 10);
    const host = process.env.HOST ?? '0.0.0.0';
    try {
        await app.listen(port, host);
    }
    catch (err) {
        const code = err?.code;
        if (code === 'EADDRINUSE') {
            bootstrapLogger.error(`Port ${port} is already in use. Stop the other process or set PORT to a free port.`);
            bootstrapLogger.error(`Example: PORT=5859 npm run dev:api`);
            process.exit(1);
        }
        throw err;
    }
    const url = await app.getUrl().catch(() => `http://${host}:${port}`);
    bootstrapLogger.log(`API listening: ${url}/api (dataDir=${process.env.APP_DATA_DIR ?? 'n/a'})`);
}
void bootstrap().catch((err) => {
    const logger = new common_1.Logger('Bootstrap');
    logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
});
//# sourceMappingURL=main.js.map