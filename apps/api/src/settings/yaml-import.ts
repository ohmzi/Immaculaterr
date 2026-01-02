import YAML from 'yaml';

type ImportResult = {
  settingsPatch: Record<string, unknown>;
  secretsPatch: Record<string, unknown>;
  warnings: string[];
};

const PLACEHOLDER_X_RE = /x{8,}/i;

function normalizeString(value: unknown): string {
  return (value === null || value === undefined ? '' : String(value)).trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDisabledSecret(value: unknown, extraDisabledLiteralsUpper: string[] = []): boolean {
  const s = normalizeString(value);
  if (!s) return true;

  const disabled = new Set<string>([
    'PLEX_TOKEN',
    'RADARR_API_KEY',
    'SONARR_API_KEY',
    'TMDB_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_CSE_ID',
    'GOOGLE_SEARCH_ENGINE_ID',
    'OPENAI_API_KEY',
    'GMAIL_APP_PASSWORD',
    'EMAIL_APP_PASSWORD',
    'APP_PASSWORD',
    ...extraDisabledLiteralsUpper,
  ]);

  if (disabled.has(s.toUpperCase())) return true;
  if (PLACEHOLDER_X_RE.test(s)) return true;
  return false;
}

function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function parseLegacyYaml(yamlText: string): unknown {
  return YAML.parse(yamlText);
}

export function buildPatchesFromLegacyConfig(config: unknown): ImportResult {
  if (!isPlainObject(config)) {
    return {
      settingsPatch: {},
      secretsPatch: {},
      warnings: ['YAML root must be a mapping/object.'],
    };
  }

  const warnings: string[] = [];
  const settingsPatch: Record<string, unknown> = {};
  const secretsPatch: Record<string, unknown> = {};

  // Plex
  const plexUrl = normalizeString(pick(config, 'plex.url'));
  const plexMovieLib = normalizeString(pick(config, 'plex.movie_library_name'));
  const plexTvLib = normalizeString(pick(config, 'plex.tv_library_name'));
  const plexCollectionName = normalizeString(pick(config, 'plex.collection_name'));
  const plexTvCollectionName = normalizeString(pick(config, 'plex.tv_collection_name'));
  const plexDeletePreference = normalizeString(pick(config, 'plex.delete_preference'));
  const plexPreserveQuality = pick(config, 'plex.preserve_quality');

  const plexTokenRaw = pick(config, 'plex.token');
  const plexToken = normalizeString(plexTokenRaw);
  if (!isDisabledSecret(plexTokenRaw, ['TOKEN'])) {
    secretsPatch.plex = { token: plexToken };
  } else if (plexToken) {
    warnings.push('Skipped plex.token (looks like a placeholder or blank).');
  }

  if (plexUrl || plexMovieLib || plexTvLib || plexCollectionName || plexTvCollectionName) {
    settingsPatch.plex = {
      ...(plexUrl ? { baseUrl: plexUrl } : {}),
      ...(plexMovieLib ? { movieLibraryName: plexMovieLib } : {}),
      ...(plexTvLib ? { tvLibraryName: plexTvLib } : {}),
      ...(plexCollectionName ? { collectionName: plexCollectionName } : {}),
      ...(plexTvCollectionName ? { tvCollectionName: plexTvCollectionName } : {}),
      ...(plexDeletePreference ? { deletePreference: plexDeletePreference } : {}),
      ...(Array.isArray(plexPreserveQuality) ? { preserveQuality: plexPreserveQuality } : {}),
    };
  }

  // TMDB
  const tmdbApiKeyRaw = pick(config, 'tmdb.api_key');
  const tmdbApiKey = normalizeString(tmdbApiKeyRaw);
  if (!isDisabledSecret(tmdbApiKeyRaw, ['TMDB'])) {
    secretsPatch.tmdb = { apiKey: tmdbApiKey };
  } else if (tmdbApiKey) {
    warnings.push('Skipped tmdb.api_key (looks like a placeholder or blank).');
  }

  // Radarr
  const radarrUrl = normalizeString(pick(config, 'radarr.url'));
  const radarrRootFolder = normalizeString(pick(config, 'radarr.root_folder'));
  const radarrTagName = pick(config, 'radarr.tag_name');
  const radarrQualityProfileId = pick(config, 'radarr.quality_profile_id');
  const radarrApiKeyRaw = pick(config, 'radarr.api_key');
  const radarrApiKey = normalizeString(radarrApiKeyRaw);

  if (!isDisabledSecret(radarrApiKeyRaw, ['RADARR'])) {
    secretsPatch.radarr = { apiKey: radarrApiKey };
  } else if (radarrApiKey) {
    warnings.push('Skipped radarr.api_key (looks like a placeholder or blank).');
  }

  if (radarrUrl || radarrRootFolder || radarrTagName || radarrQualityProfileId !== undefined) {
    settingsPatch.radarr = {
      ...(radarrUrl ? { baseUrl: radarrUrl } : {}),
      ...(radarrRootFolder ? { rootFolder: radarrRootFolder } : {}),
      ...(radarrTagName !== undefined ? { tagName: radarrTagName } : {}),
      ...(radarrQualityProfileId !== undefined ? { qualityProfileId: radarrQualityProfileId } : {}),
    };
  }

  // Sonarr
  const sonarrUrl = normalizeString(pick(config, 'sonarr.url'));
  const sonarrRootFolder = normalizeString(pick(config, 'sonarr.root_folder'));
  const sonarrTagName = pick(config, 'sonarr.tag_name');
  const sonarrQualityProfileId = pick(config, 'sonarr.quality_profile_id');
  const sonarrAutoDownload = pick(config, 'sonarr.auto_download_recommendations');
  const sonarrApiKeyRaw = pick(config, 'sonarr.api_key');
  const sonarrApiKey = normalizeString(sonarrApiKeyRaw);

  if (!isDisabledSecret(sonarrApiKeyRaw, ['SONARR'])) {
    secretsPatch.sonarr = { apiKey: sonarrApiKey };
  } else if (sonarrApiKey) {
    warnings.push('Skipped sonarr.api_key (looks like a placeholder or blank).');
  }

  if (
    sonarrUrl ||
    sonarrRootFolder ||
    sonarrTagName ||
    sonarrQualityProfileId !== undefined ||
    sonarrAutoDownload !== undefined
  ) {
    settingsPatch.sonarr = {
      ...(sonarrUrl ? { baseUrl: sonarrUrl } : {}),
      ...(sonarrRootFolder ? { rootFolder: sonarrRootFolder } : {}),
      ...(sonarrTagName !== undefined ? { tagName: sonarrTagName } : {}),
      ...(sonarrQualityProfileId !== undefined ? { qualityProfileId: sonarrQualityProfileId } : {}),
      ...(sonarrAutoDownload !== undefined ? { autoDownloadRecommendations: sonarrAutoDownload } : {}),
    };
  }

  // Google (optional)
  const googleApiKeyRaw = pick(config, 'google.api_key');
  const googleApiKey = normalizeString(googleApiKeyRaw);
  const googleSearchEngineId = normalizeString(pick(config, 'google.search_engine_id'));
  if (!isDisabledSecret(googleApiKeyRaw, ['GOOGLE'])) {
    secretsPatch.google = { apiKey: googleApiKey };
  } else if (googleApiKey) {
    warnings.push('Skipped google.api_key (looks like a placeholder or blank).');
  }
  if (googleSearchEngineId) {
    settingsPatch.google = { searchEngineId: googleSearchEngineId };
  }

  // OpenAI (optional)
  const openAiApiKeyRaw = pick(config, 'openai.api_key');
  const openAiApiKey = normalizeString(openAiApiKeyRaw);
  const openAiModel = normalizeString(pick(config, 'openai.model'));
  if (!isDisabledSecret(openAiApiKeyRaw, ['OPENAI'])) {
    secretsPatch.openai = { apiKey: openAiApiKey };
  } else if (openAiApiKey) {
    warnings.push('Skipped openai.api_key (looks like a placeholder or blank).');
  }
  if (openAiModel) {
    settingsPatch.openai = { model: openAiModel };
  }

  // Overseerr (optional)
  const overseerrUrl = normalizeString(pick(config, 'overseerr.url'));
  const overseerrApiKeyRaw = pick(config, 'overseerr.api_key');
  const overseerrApiKey = normalizeString(overseerrApiKeyRaw);
  if (!isDisabledSecret(overseerrApiKeyRaw, ['OVERSEERR'])) {
    secretsPatch.overseerr = { apiKey: overseerrApiKey };
  } else if (overseerrApiKey) {
    warnings.push('Skipped overseerr.api_key (looks like a placeholder or blank).');
  }
  if (overseerrUrl) {
    settingsPatch.overseerr = { baseUrl: overseerrUrl };
  }

  // Recommendations
  const recCount = pick(config, 'recommendations.count');
  const recWebFrac = pick(config, 'recommendations.web_context_fraction');
  if (recCount !== undefined || recWebFrac !== undefined) {
    settingsPatch.recommendations = {
      ...(recCount !== undefined ? { count: recCount } : {}),
      ...(recWebFrac !== undefined ? { webContextFraction: recWebFrac } : {}),
    };
  }

  // Script toggles
  const scriptsRun = pick(config, 'scripts_run');
  if (isPlainObject(scriptsRun)) {
    settingsPatch.scriptsRun = scriptsRun;
  }

  // Alerts (optional) - store non-secret config, but keep app password secret if present
  const email = pick(config, 'alerts.email');
  if (isPlainObject(email)) {
    const appPasswordRaw = email['app_password'];
    const appPassword = normalizeString(appPasswordRaw);
    const emailSettings: Record<string, unknown> = { ...email };
    delete emailSettings['app_password'];
    settingsPatch.alerts = { email: emailSettings };

    if (!isDisabledSecret(appPasswordRaw, ['PASSWORD'])) {
      secretsPatch.alerts = { emailAppPassword: appPassword };
    } else if (appPassword) {
      warnings.push('Skipped alerts.email.app_password (looks like a placeholder or blank).');
    }
  }

  return { settingsPatch, secretsPatch, warnings };
}


