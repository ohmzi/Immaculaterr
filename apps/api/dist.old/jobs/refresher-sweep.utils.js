"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SWEEP_ORDER = void 0;
exports.hasExplicitRefresherScopeInput = hasExplicitRefresherScopeInput;
exports.sortSweepUsers = sortSweepUsers;
exports.SWEEP_ORDER = 'non_admin_then_admin_last';
function toTimestampOrNull(value) {
    if (value instanceof Date) {
        const n = value.getTime();
        return Number.isFinite(n) ? n : null;
    }
    if (typeof value === 'string' && value.trim()) {
        const n = new Date(value).getTime();
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function hasMeaningfulScopeValue(value) {
    if (typeof value === 'string')
        return Boolean(value.trim());
    if (typeof value === 'number')
        return Number.isFinite(value);
    return false;
}
function hasExplicitRefresherScopeInput(input) {
    if (!input)
        return false;
    const raw = input;
    const scopedKeys = [
        'plexUserId',
        'plexUserTitle',
        'plexAccountId',
        'plexAccountTitle',
        'movieSectionKey',
        'tvSectionKey',
        'seedLibrarySectionId',
    ];
    return scopedKeys.some((key) => hasMeaningfulScopeValue(raw[key]));
}
function sortSweepUsers(users) {
    return users.slice().sort((a, b) => {
        if (a.isAdmin !== b.isAdmin)
            return a.isAdmin ? 1 : -1;
        const aSeen = toTimestampOrNull(a.lastSeenAt);
        const bSeen = toTimestampOrNull(b.lastSeenAt);
        if (aSeen === null && bSeen !== null)
            return -1;
        if (aSeen !== null && bSeen === null)
            return 1;
        if (aSeen !== null && bSeen !== null && aSeen !== bSeen)
            return aSeen - bSeen;
        const byTitle = a.plexAccountTitle.localeCompare(b.plexAccountTitle, undefined, {
            sensitivity: 'base',
        });
        if (byTitle !== 0)
            return byTitle;
        return a.id.localeCompare(b.id);
    });
}
//# sourceMappingURL=refresher-sweep.utils.js.map