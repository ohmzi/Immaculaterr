"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripUserCollectionPrefix = exports.CURATED_TV_COLLECTION_HUB_ORDER = exports.CURATED_MOVIE_COLLECTION_HUB_ORDER = void 0;
exports.normalizeCollectionTitle = normalizeCollectionTitle;
exports.buildUserCollectionName = buildUserCollectionName;
exports.stripUserCollectionSuffix = stripUserCollectionSuffix;
exports.resolveCuratedCollectionBaseName = resolveCuratedCollectionBaseName;
exports.curatedCollectionOrderIndex = curatedCollectionOrderIndex;
exports.hasSameCuratedCollectionBase = hasSameCuratedCollectionBase;
exports.sortCollectionNamesByCuratedBaseOrder = sortCollectionNamesByCuratedBaseOrder;
exports.buildUserCollectionHubOrder = buildUserCollectionHubOrder;
function normalizeCollectionTitle(value) {
    const raw = String(value ?? '').trim();
    if (!raw)
        return '';
    const normalized = typeof raw.normalize === 'function' ? raw.normalize('NFKD') : raw;
    return normalized
        .replace(/[\u2010-\u2015\u2212-]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
exports.CURATED_MOVIE_COLLECTION_HUB_ORDER = [
    'Based on your recently watched movie',
    'Change of Taste',
    'Inspired by your Immaculate Taste',
];
exports.CURATED_TV_COLLECTION_HUB_ORDER = [
    'Based on your recently watched show',
    'Change of Taste',
    'Inspired by your Immaculate Taste',
];
const CURATED_BASE_HINTS = {
    recentlyWatchedMovie: 'based on your recently watched movie',
    recentlyWatchedShow: 'based on your recently watched show',
    recentlyWatchedGeneric: 'based on your recently watched',
    changeOfTaste: 'change of taste',
    immaculateTaste: 'inspired by your immaculate taste',
};
const CURATED_ORDER_LOOKUP = {
    movie: new Map(exports.CURATED_MOVIE_COLLECTION_HUB_ORDER.map((name, index) => [
        normalizeCollectionTitle(name),
        index,
    ])),
    tv: new Map(exports.CURATED_TV_COLLECTION_HUB_ORDER.map((name, index) => [
        normalizeCollectionTitle(name),
        index,
    ])),
};
function buildUserCollectionName(baseName, plexUserTitle) {
    const base = String(baseName ?? '').trim();
    const title = String(plexUserTitle ?? '').trim();
    if (!base)
        return title;
    if (!title)
        return base;
    return `${base} (${title})`;
}
function stripUserCollectionSuffix(collectionName) {
    const raw = String(collectionName ?? '').trim();
    if (!raw)
        return raw;
    const parenMatch = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (parenMatch) {
        const before = parenMatch[1]?.trim() || '';
        const after = parenMatch[2]?.trim() || '';
        const baseHints = [
            'based on your',
            'change of taste',
            'inspired by your immaculate taste',
        ];
        const looksLikeBase = (value) => {
            const lower = value.toLowerCase();
            return baseHints.some((hint) => lower.includes(hint));
        };
        if (before && after) {
            const beforeIsBase = looksLikeBase(before);
            const afterIsBase = looksLikeBase(after);
            if (beforeIsBase && !afterIsBase)
                return before;
            if (afterIsBase && !beforeIsBase)
                return after;
        }
        return before || after || raw;
    }
    return raw;
}
exports.stripUserCollectionPrefix = stripUserCollectionSuffix;
function normalizeCuratedBaseName(params) {
    const candidates = [
        normalizeCollectionTitle(params.collectionName),
        normalizeCollectionTitle(stripUserCollectionSuffix(params.collectionName)),
    ].filter(Boolean);
    for (const value of candidates) {
        if (value.includes(CURATED_BASE_HINTS.changeOfTaste)) {
            return 'Change of Taste';
        }
        if (value.includes(CURATED_BASE_HINTS.immaculateTaste)) {
            return 'Inspired by your Immaculate Taste';
        }
        if (value.includes(CURATED_BASE_HINTS.recentlyWatchedMovie)) {
            return 'Based on your recently watched movie';
        }
        if (value.includes(CURATED_BASE_HINTS.recentlyWatchedShow)) {
            return 'Based on your recently watched show';
        }
        if (value.includes(CURATED_BASE_HINTS.recentlyWatchedGeneric)) {
            return params.mediaType === 'tv'
                ? 'Based on your recently watched show'
                : 'Based on your recently watched movie';
        }
    }
    return null;
}
function resolveCuratedCollectionBaseName(params) {
    return normalizeCuratedBaseName(params);
}
function curatedCollectionOrderIndex(params) {
    const base = normalizeCuratedBaseName(params);
    if (!base)
        return Number.MAX_SAFE_INTEGER;
    return (CURATED_ORDER_LOOKUP[params.mediaType].get(normalizeCollectionTitle(base)) ??
        Number.MAX_SAFE_INTEGER);
}
function hasSameCuratedCollectionBase(params) {
    const a = normalizeCuratedBaseName({
        collectionName: params.left,
        mediaType: params.mediaType,
    });
    const b = normalizeCuratedBaseName({
        collectionName: params.right,
        mediaType: params.mediaType,
    });
    return Boolean(a) && a === b;
}
function sortCollectionNamesByCuratedBaseOrder(params) {
    return params.collectionNames.slice().sort((a, b) => {
        const ai = curatedCollectionOrderIndex({
            collectionName: a,
            mediaType: params.mediaType,
        });
        const bi = curatedCollectionOrderIndex({
            collectionName: b,
            mediaType: params.mediaType,
        });
        if (ai !== bi)
            return ai - bi;
        return normalizeCollectionTitle(a).localeCompare(normalizeCollectionTitle(b));
    });
}
function buildUserCollectionHubOrder(baseNames, plexUserTitle) {
    return baseNames.map((name) => buildUserCollectionName(name, plexUserTitle));
}
//# sourceMappingURL=plex-collections.utils.js.map