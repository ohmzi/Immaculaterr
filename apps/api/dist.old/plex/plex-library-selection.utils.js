"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLEX_LIBRARY_SELECTION_MIN_SELECTED = void 0;
exports.sanitizeSectionKeys = sanitizeSectionKeys;
exports.readConfiguredExcludedSectionKeys = readConfiguredExcludedSectionKeys;
exports.toEligiblePlexLibraries = toEligiblePlexLibraries;
exports.resolvePlexLibrarySelection = resolvePlexLibrarySelection;
exports.buildExcludedSectionKeysFromSelected = buildExcludedSectionKeysFromSelected;
exports.isPlexLibrarySectionExcluded = isPlexLibrarySectionExcluded;
exports.PLEX_LIBRARY_SELECTION_MIN_SELECTED = 1;
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function pick(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const part of parts) {
        if (!isPlainObject(cur))
            return undefined;
        cur = cur[part];
    }
    return cur;
}
function normalizeSectionKey(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(Math.trunc(value));
    }
    return '';
}
function sanitizeSectionKeys(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    const seen = new Set();
    for (const raw of value) {
        const key = normalizeSectionKey(raw);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}
function readConfiguredExcludedSectionKeys(settings) {
    return sanitizeSectionKeys(pick(settings, 'plex.librarySelection.excludedSectionKeys'));
}
function toEligiblePlexLibraries(sections) {
    const out = [];
    const seen = new Set();
    for (const section of sections) {
        const key = String(section.key ?? '').trim();
        const title = String(section.title ?? '').trim();
        const rawType = String(section.type ?? '').trim().toLowerCase();
        if (!key || !title)
            continue;
        if (rawType !== 'movie' && rawType !== 'show')
            continue;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({ key, title, type: rawType });
    }
    out.sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
    return out;
}
function resolvePlexLibrarySelection(params) {
    const eligibleLibraries = toEligiblePlexLibraries(params.sections);
    const eligibleSet = new Set(eligibleLibraries.map((s) => s.key));
    const excludedSectionKeys = readConfiguredExcludedSectionKeys(params.settings).filter((key) => eligibleSet.has(key));
    const excludedSet = new Set(excludedSectionKeys);
    const selectedSectionKeys = eligibleLibraries
        .map((lib) => lib.key)
        .filter((key) => !excludedSet.has(key));
    return {
        eligibleLibraries,
        excludedSectionKeys,
        selectedSectionKeys,
    };
}
function buildExcludedSectionKeysFromSelected(params) {
    const selected = sanitizeSectionKeys(params.selectedSectionKeys);
    const selectedSet = new Set(selected);
    return params.eligibleLibraries
        .map((lib) => String(lib.key ?? '').trim())
        .filter((key) => key && !selectedSet.has(key));
}
function isPlexLibrarySectionExcluded(params) {
    const key = normalizeSectionKey(params.sectionKey);
    if (!key)
        return false;
    return readConfiguredExcludedSectionKeys(params.settings).includes(key);
}
//# sourceMappingURL=plex-library-selection.utils.js.map