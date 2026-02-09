"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.immaculateTasteResetMarkerKey = immaculateTasteResetMarkerKey;
function immaculateTasteResetMarkerKey(params) {
    const mediaType = params.mediaType;
    const librarySectionKey = params.librarySectionKey.trim();
    return `immaculateTaste.resetAt.${mediaType}.${librarySectionKey}`;
}
//# sourceMappingURL=immaculate-taste-reset.js.map