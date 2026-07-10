/**
 * Size-capped quality profiles for the large-file replacement flow.
 *
 * Radarr/Sonarr cannot limit size per profile directly, so the profile pairs
 * a custom format carrying a Size condition with a -10000 score: any release
 * over the cap scores below the profile's minimum format score and is
 * rejected. Episodes additionally prefer a 1-2 GB sweet spot via a positively
 * scored format. Profiles and formats are created once on the first real run
 * and reused (matched by name) forever after.
 */

export const SIZE_CAPPED_MOVIE_PROFILE = {
  profileName: 'Immaculaterr 10GB Movie Cap',
  blockFormatName: 'Immaculaterr: Block >10GB Movie',
  capGb: 10,
  idealFormatName: null as string | null,
  idealMinGb: 0,
  idealMaxGb: 0,
};

export const SIZE_CAPPED_EPISODE_PROFILE = {
  profileName: 'Immaculaterr 3GB Episode Cap',
  blockFormatName: 'Immaculaterr: Block >3GB Episode',
  capGb: 3,
  idealFormatName: 'Immaculaterr: 1-2GB Episode Sweet Spot' as string | null,
  idealMinGb: 1,
  idealMaxGb: 2,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Custom format matching anything LARGER than `minGb` (scored -10000). */
export function buildSizeBlockFormat(
  name: string,
  minGb: number,
): Record<string, unknown> {
  return {
    name,
    includeCustomFormatWhenRenaming: false,
    specifications: [
      {
        name: `Larger than ${minGb} GB`,
        implementation: 'SizeSpecification',
        negate: false,
        required: true,
        fields: [
          { name: 'min', value: minGb },
          { name: 'max', value: 10000 },
        ],
      },
    ],
  };
}

/** Custom format matching the preferred size window (scored positively). */
export function buildSizePreferenceFormat(
  name: string,
  minGb: number,
  maxGb: number,
): Record<string, unknown> {
  return {
    name,
    includeCustomFormatWhenRenaming: false,
    specifications: [
      {
        name: `Between ${minGb} and ${maxGb} GB`,
        implementation: 'SizeSpecification',
        negate: false,
        required: true,
        fields: [
          { name: 'min', value: minGb },
          { name: 'max', value: maxGb },
        ],
      },
    ],
  };
}

function collectItemNames(item: Record<string, unknown>): string[] {
  const names: string[] = [];
  if (typeof item['name'] === 'string') names.push(item['name']);
  const quality = item['quality'];
  if (isPlainObject(quality) && typeof quality['name'] === 'string') {
    names.push(quality['name']);
  }
  const nested = Array.isArray(item['items']) ? item['items'] : [];
  for (const child of nested) {
    if (!isPlainObject(child)) continue;
    const childQuality = child['quality'];
    if (
      isPlainObject(childQuality) &&
      typeof childQuality['name'] === 'string'
    ) {
      names.push(childQuality['name']);
    }
  }
  return names;
}

function itemId(item: Record<string, unknown>): number | null {
  if (typeof item['id'] === 'number') return item['id'];
  const quality = item['quality'];
  if (isPlainObject(quality) && typeof quality['id'] === 'number') {
    return quality['id'];
  }
  return null;
}

// Disc images and unknowns can never satisfy a size cap sensibly, and
// pre-retail junk (CAM et al.) must never win just because it fits the cap.
const EXCLUDED_QUALITY =
  /br-?disk|raw-?hd|^unknown$|workprint|^cam$|telesync|telecine|regional|dvdscr/i;

/**
 * Builds a create-ready quality profile from the app's /qualityprofile/schema:
 * every sensible quality allowed, cutoff at WEBDL-1080p (or the best allowed),
 * upgrades on, and the given custom-format scores applied. The size cap does
 * the real work — quality selection stays broad on purpose.
 */
export function buildSizeCappedProfile(params: {
  name: string;
  schema: Record<string, unknown>;
  formats: Array<Record<string, unknown> & { id: number; name?: string }>;
  formatScores: Map<number, number>;
}): Record<string, unknown> {
  const profile = JSON.parse(JSON.stringify(params.schema)) as Record<
    string,
    unknown
  >;
  const items = Array.isArray(profile['items'])
    ? (profile['items'] as unknown[]).filter(isPlainObject)
    : [];

  let cutoff: number | null = null;
  let bestAllowedId: number | null = null;
  for (const item of items) {
    const names = collectItemNames(item);
    const allowed =
      names.length > 0 && !names.some((n) => EXCLUDED_QUALITY.test(n));
    item['allowed'] = allowed;
    const nested = Array.isArray(item['items']) ? item['items'] : [];
    for (const child of nested) {
      if (isPlainObject(child)) child['allowed'] = allowed;
    }
    const id = itemId(item);
    if (!allowed || id === null) continue;
    bestAllowedId = id; // schema orders worst -> best
    if (names.some((n) => n.toLowerCase() === 'webdl-1080p')) cutoff = id;
  }

  profile['name'] = params.name;
  profile['upgradeAllowed'] = true;
  if (cutoff !== null || bestAllowedId !== null) {
    profile['cutoff'] = cutoff ?? bestAllowedId;
  }
  profile['minFormatScore'] = 0;
  profile['cutoffFormatScore'] = 0;
  profile['formatItems'] = params.formats.map((format) => ({
    format: format.id,
    name: typeof format.name === 'string' ? format.name : `format-${format.id}`,
    score: params.formatScores.get(format.id) ?? 0,
  }));
  delete profile['id'];
  return profile;
}
