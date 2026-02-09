"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeHtmlEntities = decodeHtmlEntities;
exports.normalizeTitleForMatching = normalizeTitleForMatching;
exports.buildTitleQueryVariants = buildTitleQueryVariants;
const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    middot: '·',
};
function fromCodePointSafe(cp) {
    if (!Number.isFinite(cp))
        return null;
    const n = Math.trunc(cp);
    if (n < 0 || n > 0x10ffff)
        return null;
    if (n >= 0xd800 && n <= 0xdfff)
        return null;
    try {
        return String.fromCodePoint(n);
    }
    catch {
        return null;
    }
}
function decodeHtmlEntities(input) {
    let s = input ?? '';
    if (!s)
        return '';
    s = s.replace(/&#x([0-9a-fA-F]{1,8});/g, (_m, hex) => {
        const cp = Number.parseInt(hex, 16);
        return fromCodePointSafe(cp) ?? _m;
    });
    s = s.replace(/&#([0-9]{1,8});/g, (_m, dec) => {
        const cp = Number.parseInt(dec, 10);
        return fromCodePointSafe(cp) ?? _m;
    });
    s = s.replace(/&([a-zA-Z]{2,12});/g, (_m, name) => {
        const key = name.toLowerCase();
        return NAMED_ENTITIES[key] ?? _m;
    });
    return s;
}
function normalizeTitleForMatching(raw) {
    let s = decodeHtmlEntities(raw ?? '').trim();
    if (!s)
        return '';
    try {
        s = s.normalize('NFKC');
    }
    catch {
    }
    s = s
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b-\u200f\u202a-\u202e]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    s = s
        .replace(/[\u2018\u2019\u02bc]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .trim();
    return s;
}
function buildTitleQueryVariants(title) {
    const base = normalizeTitleForMatching(title);
    if (!base)
        return [];
    const variants = [];
    const push = (v) => {
        const t = v.trim();
        if (!t)
            return;
        if (!variants.includes(t))
            variants.push(t);
    };
    push(base);
    push(base.replace(/·/g, ' ').replace(/\s+/g, ' ').trim());
    push(base.replace(/·/g, '').replace(/\s+/g, ' ').trim());
    push(base.replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim());
    push(base.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim());
    return variants.slice(0, 8);
}
//# sourceMappingURL=title-normalize.js.map