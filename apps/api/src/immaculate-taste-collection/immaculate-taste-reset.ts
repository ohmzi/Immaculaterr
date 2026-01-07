export type ImmaculateTasteMediaType = 'movie' | 'tv';

export function immaculateTasteResetMarkerKey(params: {
  mediaType: ImmaculateTasteMediaType;
  librarySectionKey: string;
}): string {
  const mediaType = params.mediaType;
  const librarySectionKey = params.librarySectionKey.trim();
  return `immaculateTaste.resetAt.${mediaType}.${librarySectionKey}`;
}



