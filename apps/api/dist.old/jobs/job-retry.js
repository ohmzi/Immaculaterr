"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withJobRetry = withJobRetry;
exports.withJobRetryOrNull = withJobRetryOrNull;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function errToMessage(err) {
    if (err instanceof Error)
        return err.message || err.name;
    return String(err);
}
async function withJobRetry(fn, options) {
    const attempts = options.attempts ?? 3;
    const delayMs = options.delayMs ?? 10_000;
    const label = options.label;
    const ctx = options.ctx;
    const meta = options.meta ?? {};
    let lastErr = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            const error = errToMessage(err);
            if (attempt < attempts) {
                if (ctx) {
                    await ctx.warn(`${label}: failed (attempt ${attempt}/${attempts}) — retrying`, {
                        attempt,
                        attempts,
                        delayMs,
                        error,
                        ...meta,
                    });
                }
                await sleep(delayMs);
                continue;
            }
            if (ctx) {
                await ctx.warn(`${label}: failed after ${attempts} attempts`, {
                    attempt,
                    attempts,
                    error,
                    ...meta,
                });
            }
            throw err;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(errToMessage(lastErr));
}
async function withJobRetryOrNull(fn, options) {
    try {
        return await withJobRetry(fn, options);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=job-retry.js.map