"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOriginCheckMiddleware = createOriginCheckMiddleware;
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function normalizeAllowedOrigin(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    try {
        return new URL(trimmed).origin;
    }
    catch {
        return trimmed;
    }
}
function createOriginCheckMiddleware(options = {}) {
    const allowed = new Set();
    for (const origin of options.allowedOrigins ?? []) {
        const normalized = normalizeAllowedOrigin(origin);
        if (normalized)
            allowed.add(normalized);
    }
    const getExpectedHost = (req) => {
        const xfHostRaw = req.headers['x-forwarded-host'];
        const xfHost = typeof xfHostRaw === 'string'
            ? xfHostRaw
            : Array.isArray(xfHostRaw)
                ? xfHostRaw.join(',')
                : '';
        const forwardedHost = xfHost.split(',')[0]?.trim().toLowerCase() || '';
        const hostHeader = typeof req.headers.host === 'string'
            ? req.headers.host.trim().toLowerCase()
            : '';
        return forwardedHost || hostHeader || null;
    };
    return function originCheck(req, res, next) {
        if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase()))
            return next();
        const originHeader = req.headers.origin;
        if (typeof originHeader !== 'string' || originHeader.trim() === '')
            return next();
        let originUrl;
        try {
            originUrl = new URL(originHeader);
        }
        catch {
            res.status(403).json({
                statusCode: 403,
                message: 'Forbidden',
                error: 'Invalid Origin',
            });
            return;
        }
        const hostHeader = getExpectedHost(req) ?? '';
        if (!hostHeader.trim()) {
            res.status(403).json({
                statusCode: 403,
                message: 'Forbidden',
                error: 'Missing Host',
            });
            return;
        }
        const originHost = originUrl.host.toLowerCase();
        if (originHost === hostHeader)
            return next();
        const normalizedOrigin = originUrl.origin;
        if (allowed.has(normalizedOrigin) || allowed.has(originHeader.trim()))
            return next();
        res.status(403).json({
            statusCode: 403,
            message: 'Forbidden',
            error: 'Origin mismatch',
        });
    };
}
//# sourceMappingURL=origin-check.middleware.js.map