"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricRow = metricRow;
exports.issue = issue;
exports.issuesFromWarnings = issuesFromWarnings;
exports.issuesFromErrorMessage = issuesFromErrorMessage;
function asFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function metricRow(params) {
    const row = {
        label: params.label,
        start: asFiniteNumber(params.start),
        changed: asFiniteNumber(params.changed),
        end: asFiniteNumber(params.end),
    };
    const unit = (params.unit ?? '').trim();
    if (unit)
        row.unit = unit;
    const note = (params.note ?? '').trim();
    if (note)
        row.note = note;
    return row;
}
function issue(level, message) {
    return { level, message: String(message ?? '').trim() };
}
function issuesFromWarnings(warnings) {
    if (!Array.isArray(warnings))
        return [];
    const out = [];
    for (const w of warnings) {
        const msg = String(w ?? '').trim();
        if (!msg)
            continue;
        out.push(issue('warn', msg));
    }
    return out;
}
function issuesFromErrorMessage(errorMessage) {
    const msg = String(errorMessage ?? '').trim();
    if (!msg)
        return [];
    return [issue('error', msg)];
}
//# sourceMappingURL=job-report-v1.js.map