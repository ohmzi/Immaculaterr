import { SettingsPage } from '@/pages/VaultPage';
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import {
  CircleAlert,
  ExternalLink,
  Film,
  ImageIcon,
  Upload,
  Info,
  Loader2,
  RotateCcw,
  Settings2,
  Tv,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  getPlexLibraries,
  getPlexLibraryFilters,
  getPlexMonitoringUsers,
  getRadarrOptions,
  getRadarrOptionsForInstance,
  savePlexMonitoringUsers,
  getSonarrOptions,
  getSonarrOptionsForInstance,
  savePlexLibrarySelection,
  type PlexMonitoringUserItem,
  type RadarrOptionsResponse,
  type SonarrOptionsResponse,
} from '@/api/integrations';
import { listArrInstances, updateArrInstance } from '@/api/arr-instances';
import {
  createImmaculateTasteProfile,
  deleteImmaculateTasteProfile,
  listImmaculateTasteProfiles,
  updateImmaculateTasteProfile,
  type ImmaculateTasteProfile,
  type ImmaculateTasteProfileMatchMode,
  type ImmaculateTasteProfileMediaType,
} from '@/api/immaculate-taste-profiles';
import {
  getImmaculateTasteCollections,
  getImmaculateTasteUserSummary,
  resetImmaculateTasteCollection,
  resetImmaculateTasteUserCollection,
} from '@/api/immaculate';
import {
  deleteCollectionArtworkOverride,
  getCollectionArtworkPreviewUrl,
  getManagedCollectionArtworkTargets,
  uploadCollectionArtworkOverride,
  type CollectionArtworkTarget,
} from '@/api/collection-artwork';
import {
  resetRejectedSuggestions,
  listRejectedSuggestions,
  deleteRejectedSuggestion,
  type RejectedSuggestionItem,
} from '@/api/observatory';
import { resetSeerrRequests } from '@/api/seerr';
import { getPublicSettings, putSettings } from '@/api/settings';
import { ApiError } from '@/api/http';
import { RadarrLogo, SonarrLogo } from '@/components/ArrLogos';
import { FunCountSlider } from '@/components/FunCountSlider';
import { SavingPill } from '@/components/SavingPill';
import { FunSplitSlider } from '@/components/FunSplitSlider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { APP_HEADER_STATUS_PILL_BASE_CLASS } from '@/lib/ui-classes';
import {
  FAQ_SECTION_BY_COMMAND_CENTER_CARD_ID,
  type CommandCenterFeatureCardId,
} from '@/lib/faq-feature-links';
import { ConfirmDialog } from '@/components/ConfirmDialog';

function readBool(obj: unknown, path: string): boolean | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'boolean' ? cur : null;
}

function readString(obj: unknown, path: string): string {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur.trim() : '';
}

function readNumber(obj: unknown, path: string): number | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === 'number' && Number.isFinite(cur)) return cur;
  if (typeof cur === 'string' && cur.trim()) {
    const n = Number.parseInt(cur.trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readNonEmptyStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0,
  );
}

function readErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fallback;
  const message = (data as Record<string, unknown>).message;
  if (typeof message === 'string') {
    const trimmed = message.trim();
    return trimmed || fallback;
  }
  const parts = readNonEmptyStrings(message);
  return parts.length ? parts.join(', ') : fallback;
}

function normalizeCsvStringList(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(',')) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const PRIMARY_INSTANCE_SENTINEL = '__primary__';
const TOP_10_POPULAR_AUDIO_LANGUAGES = [
  'English',
  'Mandarin Chinese',
  'Hindi',
  'Spanish',
  'French',
  'Arabic',
  'Bengali',
  'Portuguese',
  'Russian',
  'Japanese',
];
const DEFAULT_IMMACULATE_MOVIE_COLLECTION_BASE_NAME =
  'Inspired by your Immaculate Taste in Movies';
const DEFAULT_IMMACULATE_SHOW_COLLECTION_BASE_NAME =
  'Inspired by your Immaculate Taste in Shows';

function normalizeCollectionBaseName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function mediaTypeIncludesMovie(mediaType: ImmaculateTasteProfileMediaType): boolean {
  return mediaType === 'movie' || mediaType === 'both';
}

function mediaTypeIncludesShow(mediaType: ImmaculateTasteProfileMediaType): boolean {
  return mediaType === 'show' || mediaType === 'both';
}

function resolveMovieCollectionBaseName(value: string | null | undefined): string {
  return (value ?? '').trim() || DEFAULT_IMMACULATE_MOVIE_COLLECTION_BASE_NAME;
}

function resolveShowCollectionBaseName(value: string | null | undefined): string {
  return (value ?? '').trim() || DEFAULT_IMMACULATE_SHOW_COLLECTION_BASE_NAME;
}

function profileUsesCollectionBaseName(params: {
  profile: ImmaculateTasteProfile;
  mediaType: 'movie' | 'show';
  collectionBaseName: string;
}): boolean {
  const target = normalizeCollectionBaseName(params.collectionBaseName);
  if (!target) return false;

  const profileMediaIncludes =
    params.mediaType === 'movie'
      ? mediaTypeIncludesMovie(params.profile.mediaType)
      : mediaTypeIncludesShow(params.profile.mediaType);
  if (!params.profile.userOverrides.length && profileMediaIncludes) {
    const profileBase =
      params.mediaType === 'movie'
        ? resolveMovieCollectionBaseName(params.profile.movieCollectionBaseName)
        : resolveShowCollectionBaseName(params.profile.showCollectionBaseName);
    if (normalizeCollectionBaseName(profileBase) === target) return true;
  }

  for (const override of params.profile.userOverrides) {
    const overrideMediaIncludes =
      params.mediaType === 'movie'
        ? mediaTypeIncludesMovie(override.mediaType)
        : mediaTypeIncludesShow(override.mediaType);
    if (!overrideMediaIncludes) continue;
    const overrideBase =
      params.mediaType === 'movie'
        ? resolveMovieCollectionBaseName(
            override.movieCollectionBaseName ?? params.profile.movieCollectionBaseName,
          )
        : resolveShowCollectionBaseName(
            override.showCollectionBaseName ?? params.profile.showCollectionBaseName,
          );
    if (normalizeCollectionBaseName(overrideBase) === target) return true;
  }

  return false;
}

function resolveEffectiveProfileScopeForPlexUser(params: {
  profile: ImmaculateTasteProfile;
  plexUserId: string | null;
}): {
  mediaType: ImmaculateTasteProfileMediaType;
  movieCollectionBaseName: string;
  showCollectionBaseName: string;
} | null {
  const profileOverrides = params.profile.userOverrides ?? [];
  const override =
    params.plexUserId
      ? profileOverrides.find(
          (candidate) => candidate.plexUserId === params.plexUserId,
        ) ?? null
      : null;
  if (profileOverrides.length > 0 && !override) return null;
  return {
    mediaType: override?.mediaType ?? params.profile.mediaType,
    movieCollectionBaseName: resolveMovieCollectionBaseName(
      override?.movieCollectionBaseName ?? params.profile.movieCollectionBaseName,
    ),
    showCollectionBaseName: resolveShowCollectionBaseName(
      override?.showCollectionBaseName ?? params.profile.showCollectionBaseName,
    ),
  };
}

function buildImmaculateCollectionName(
  collectionBaseName: string,
  plexAccountTitle: string,
): string {
  const normalizedBaseName = collectionBaseName.trim();
  const normalizedUserTitle = plexAccountTitle.trim();
  if (!normalizedUserTitle) return normalizedBaseName;
  return `${normalizedBaseName} (${normalizedUserTitle})`;
}

function getCollectionArtworkTargetKey(
  target: Pick<CollectionArtworkTarget, 'mediaType' | 'targetKind' | 'targetId'>,
): string {
  return `${target.mediaType}::${target.targetKind}::${target.targetId}`;
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size < 1024) return `${Math.trunc(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function dedupeCaseInsensitive(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizeStringListForComparison(values: string[]): string[] {
  return dedupeCaseInsensitive(values).map((value) => value.toLowerCase());
}

function areCaseInsensitiveListsEqual(left: string[], right: string[]): boolean {
  return (
    JSON.stringify(normalizeStringListForComparison(left)) ===
    JSON.stringify(normalizeStringListForComparison(right))
  );
}

type ImmaculateTasteProfileDraft = {
  name: string;
  enabled: boolean;
  mediaType: ImmaculateTasteProfileMediaType;
  matchMode: ImmaculateTasteProfileMatchMode;
  includeGenreFilterEnabled: boolean;
  includeGenresText: string;
  includeAudioLanguageFilterEnabled: boolean;
  includeAudioLanguagesText: string;
  excludeGenreFilterEnabled: boolean;
  excludeGenresText: string;
  excludeAudioLanguageFilterEnabled: boolean;
  excludeAudioLanguagesText: string;
  radarrInstanceId: string;
  sonarrInstanceId: string;
  movieCollectionBaseName: string;
  showCollectionBaseName: string;
};

type ProfileDeleteImpactSummary = {
  uniqueCollectionNames: string[];
  sharedCollectionNames: string[];
  defaultWillAutoEnable: boolean;
};

type PlexMonitoringDeselectedUser = {
  id: string;
  plexAccountTitle: string;
};

function resolveProfileDraftFilters(draft: ImmaculateTasteProfileDraft): {
  includedGenres: string[];
  includedAudioLanguages: string[];
  excludedGenres: string[];
  excludedAudioLanguages: string[];
} {
  return {
    includedGenres: draft.includeGenreFilterEnabled
      ? normalizeCsvStringList(draft.includeGenresText)
      : [],
    includedAudioLanguages: draft.includeAudioLanguageFilterEnabled
      ? normalizeCsvStringList(draft.includeAudioLanguagesText)
      : [],
    excludedGenres: draft.excludeGenreFilterEnabled
      ? normalizeCsvStringList(draft.excludeGenresText)
      : [],
    excludedAudioLanguages: draft.excludeAudioLanguageFilterEnabled
      ? normalizeCsvStringList(draft.excludeAudioLanguagesText)
      : [],
  };
}

function toProfileDraft(
  profile: ImmaculateTasteProfile,
  override: ImmaculateTasteProfile['userOverrides'][number] | null = null,
): ImmaculateTasteProfileDraft {
  const genres = override?.genres ?? profile.genres ?? [];
  const audioLanguages = override?.audioLanguages ?? profile.audioLanguages ?? [];
  const excludedGenres = override?.excludedGenres ?? profile.excludedGenres ?? [];
  const excludedAudioLanguages =
    override?.excludedAudioLanguages ?? profile.excludedAudioLanguages ?? [];
  return {
    name: profile.name,
    enabled: profile.enabled,
    mediaType: override?.mediaType ?? profile.mediaType,
    matchMode: override?.matchMode ?? profile.matchMode,
    includeGenreFilterEnabled: genres.length > 0,
    includeGenresText: genres.join(', '),
    includeAudioLanguageFilterEnabled: audioLanguages.length > 0,
    includeAudioLanguagesText: audioLanguages.join(', '),
    excludeGenreFilterEnabled: excludedGenres.length > 0,
    excludeGenresText: excludedGenres.join(', '),
    excludeAudioLanguageFilterEnabled: excludedAudioLanguages.length > 0,
    excludeAudioLanguagesText: excludedAudioLanguages.join(', '),
    radarrInstanceId:
      (override?.radarrInstanceId ?? profile.radarrInstanceId) ??
      PRIMARY_INSTANCE_SENTINEL,
    sonarrInstanceId:
      (override?.sonarrInstanceId ?? profile.sonarrInstanceId) ??
      PRIMARY_INSTANCE_SENTINEL,
    movieCollectionBaseName:
      override?.movieCollectionBaseName ?? profile.movieCollectionBaseName ?? '',
    showCollectionBaseName:
      override?.showCollectionBaseName ?? profile.showCollectionBaseName ?? '',
  };
}

function findProfileUserOverride(
  profile: ImmaculateTasteProfile | null,
  plexUserId: string | null,
): ImmaculateTasteProfile['userOverrides'][number] | null {
  if (!profile || !plexUserId) return null;
  return profile.userOverrides.find((override) => override.plexUserId === plexUserId) ?? null;
}

function createNewProfileDraft(): ImmaculateTasteProfileDraft {
  return {
    name: '',
    enabled: true,
    mediaType: 'both',
    matchMode: 'any',
    includeGenreFilterEnabled: false,
    includeGenresText: '',
    includeAudioLanguageFilterEnabled: false,
    includeAudioLanguagesText: '',
    excludeGenreFilterEnabled: false,
    excludeGenresText: '',
    excludeAudioLanguageFilterEnabled: false,
    excludeAudioLanguagesText: '',
    radarrInstanceId: PRIMARY_INSTANCE_SENTINEL,
    sonarrInstanceId: PRIMARY_INSTANCE_SENTINEL,
    movieCollectionBaseName: '',
    showCollectionBaseName: '',
  };
}

function createNetZeroDefaultProfileDraft(profileName: string): ImmaculateTasteProfileDraft {
  return {
    ...createNewProfileDraft(),
    name: profileName,
  };
}

function isNetZeroDefaultProfileDraft(
  draft: ImmaculateTasteProfileDraft,
  profileName: string,
): boolean {
  const filters = resolveProfileDraftFilters(draft);
  return (
    draft.name.trim() === profileName.trim() &&
    draft.enabled &&
    draft.mediaType === 'both' &&
    draft.matchMode === 'any' &&
    filters.includedGenres.length === 0 &&
    filters.includedAudioLanguages.length === 0 &&
    filters.excludedGenres.length === 0 &&
    filters.excludedAudioLanguages.length === 0 &&
    draft.radarrInstanceId === PRIMARY_INSTANCE_SENTINEL &&
    draft.sonarrInstanceId === PRIMARY_INSTANCE_SENTINEL &&
    draft.movieCollectionBaseName.trim() === '' &&
    draft.showCollectionBaseName.trim() === ''
  );
}

export function CommandCenterPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [flashCard, setFlashCard] = useState<{ id: string; nonce: number } | null>(null);
  const [immaculateResetTarget, setImmaculateResetTarget] = useState<{
    mediaType: 'movie' | 'tv';
    librarySectionKey: string;
    libraryTitle: string;
    dataset: { total: number; active: number; pending: number };
    plex: {
      collectionName: string;
      collectionRatingKey: string | null;
      itemCount: number | null;
    };
  } | null>(null);
  const [activeImmaculateUserId, setActiveImmaculateUserId] = useState<string | null>(
    null,
  );
  const [immaculateUserResetTarget, setImmaculateUserResetTarget] = useState<{
    plexUserId: string;
    plexUserTitle: string;
    mediaType: 'movie' | 'tv';
    total: number;
  } | null>(null);
  const [rejectedResetOpen, setRejectedResetOpen] = useState(false);
  const [seerrResetOpen, setSeerrResetOpen] = useState(false);
  const [rejectedListOpen, setRejectedListOpen] = useState(false);
  const [rejectedMediaTab, setRejectedMediaTab] = useState<'movie' | 'tv'>('movie');
  const [rejectedKind, setRejectedKind] = useState<
    'all' | 'immaculateTaste' | 'recentlyWatched' | 'changeOfTaste'
  >('all');
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [activeProfileScopePlexUserId, setActiveProfileScopePlexUserId] = useState<
    string | null
  >(null);
  const [profileScopeSearch, setProfileScopeSearch] = useState('');
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [isAddProfileFormOpen, setIsAddProfileFormOpen] = useState(false);
  const [newProfileDraft, setNewProfileDraft] =
    useState<ImmaculateTasteProfileDraft | null>(null);
  const [newProfileScopePlexUserIds, setNewProfileScopePlexUserIds] = useState<
    string[]
  >([]);
  const [newProfileScopeSearch, setNewProfileScopeSearch] = useState('');
  const [newProfileGenreSearch, setNewProfileGenreSearch] = useState('');
  const [newProfileAudioLanguageSearch, setNewProfileAudioLanguageSearch] = useState('');
  const [newProfileExcludeGenreSearch, setNewProfileExcludeGenreSearch] = useState('');
  const [newProfileExcludeAudioLanguageSearch, setNewProfileExcludeAudioLanguageSearch] =
    useState('');
  const [genreSearch, setGenreSearch] = useState('');
  const [audioLanguageSearch, setAudioLanguageSearch] = useState('');
  const [excludeGenreSearch, setExcludeGenreSearch] = useState('');
  const [excludeAudioLanguageSearch, setExcludeAudioLanguageSearch] = useState('');
  const [profileDraft, setProfileDraft] = useState<ImmaculateTasteProfileDraft | null>(
    null,
  );
  const [collectionArtworkUserSearch, setCollectionArtworkUserSearch] = useState('');
  const [selectedCollectionArtworkUserId, setSelectedCollectionArtworkUserId] = useState<
    string | null
  >(null);
  const [selectedCollectionArtworkTargetKey, setSelectedCollectionArtworkTargetKey] =
    useState('');
  const [collectionArtworkFile, setCollectionArtworkFile] = useState<File | null>(null);
  const [collectionArtworkPreviewOpen, setCollectionArtworkPreviewOpen] = useState(false);
  const [collectionArtworkPreviewFailed, setCollectionArtworkPreviewFailed] = useState(false);
  const collectionArtworkFileInputRef = useRef<HTMLInputElement | null>(null);
  const profileEditorCardRef = useRef<HTMLDivElement | null>(null);
  const faqLinkButtonClass =
    'inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold leading-none text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs';
  const renderFeatureCardFlash = (featureId: string) => (
    <AnimatePresence initial={false}>
      {flashCard?.id === featureId ? (
        <motion.div
          key={`${flashCard.nonce}-${featureId}-glow`}
          className="pointer-events-none absolute inset-0 rounded-3xl"
          initial={{ boxShadow: '0 0 0px rgba(250, 204, 21, 0)' }}
          animate={{
            boxShadow: [
              '0 0 0px rgba(250, 204, 21, 0)',
              '0 0 30px rgba(250, 204, 21, 0.5)',
              '0 0 0px rgba(250, 204, 21, 0)',
              '0 0 30px rgba(250, 204, 21, 0.5)',
              '0 0 0px rgba(250, 204, 21, 0)',
              '0 0 30px rgba(250, 204, 21, 0.5)',
              '0 0 0px rgba(250, 204, 21, 0)',
            ],
          }}
          exit={{ boxShadow: '0 0 0px rgba(250, 204, 21, 0)' }}
          transition={{ duration: 3.8, ease: 'easeInOut' }}
        />
      ) : null}
    </AnimatePresence>
  );
  const openFeatureFaq = useCallback(
    (featureId: CommandCenterFeatureCardId) => {
      const faqSectionId = FAQ_SECTION_BY_COMMAND_CENTER_CARD_ID[featureId];
      const returnUrl = `${location.pathname}${location.search}#${featureId}`;
      window.history.replaceState(window.history.state, '', returnUrl);
      void navigate(`/faq#${faqSectionId}`);
    },
    [location.pathname, location.search, navigate],
  );
  const renderFeatureFaqButton = (featureId: CommandCenterFeatureCardId, label: string) => (
    <button
      type="button"
      onClick={() => openFeatureFaq(featureId)}
      className={faqLinkButtonClass}
      aria-label={`Open FAQ for ${label}`}
      title={`Open FAQ for ${label}`}
    >
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span className="max-[420px]:hidden">FAQ</span>
    </button>
  );
  useEffect(() => {
    if (!flashCard) return;
    const t = window.setTimeout(() => setFlashCard(null), 4200);
    return () => window.clearTimeout(t);
  }, [flashCard]);
  useEffect(() => {
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!hash) return;
    const el = document.getElementById(hash);
    if (!el) return;

    const centerFeatureCard = (behavior: ScrollBehavior) => {
      const rect = el.getBoundingClientRect();
      // Center around the feature heading area instead of the full card height.
      const headingAnchorOffset = Math.min(56, Math.max(0, rect.height / 3));
      const anchorY = rect.top + headingAnchorOffset;
      const targetTop = window.scrollY + anchorY - window.innerHeight / 2;
      window.scrollTo({ top: Math.max(0, targetTop), behavior });
    };

    const rafId = window.requestAnimationFrame(() => {
      centerFeatureCard('smooth');
    });
    const settleId = window.setTimeout(() => centerFeatureCard('smooth'), 320);
    const finalId = window.setTimeout(() => centerFeatureCard('auto'), 900);
    const flashId = window.setTimeout(() => {
      setFlashCard({ id: hash, nonce: Date.now() });
    }, 0);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleId);
      window.clearTimeout(finalId);
      window.clearTimeout(flashId);
    };
  }, [location.hash]);
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const arrInstancesQuery = useQuery({
    queryKey: ['arr-instances'],
    queryFn: () => listArrInstances(),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const immaculateProfilesQuery = useQuery({
    queryKey: ['immaculateTaste', 'profiles'],
    queryFn: listImmaculateTasteProfiles,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const plexLibraryFiltersQuery = useQuery({
    queryKey: ['integrations', 'plex', 'library-filters'],
    queryFn: () => getPlexLibraryFilters(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const [plexLibraryMinDialogOpen, setPlexLibraryMinDialogOpen] =
    useState(false);
  const [plexLibraryDeselectDialogOpen, setPlexLibraryDeselectDialogOpen] =
    useState(false);
  const [plexUserDeselectDialogOpen, setPlexUserDeselectDialogOpen] =
    useState(false);
  const [pendingPlexUserDeselectUsers, setPendingPlexUserDeselectUsers] =
    useState<PlexMonitoringDeselectedUser[]>([]);
  const [profileDeleteDialogOpen, setProfileDeleteDialogOpen] = useState(false);
  const [draftSelectedPlexLibraryKeys, setDraftSelectedPlexLibraryKeys] =
    useState<string[]>([]);
  const [draftSelectedPlexUserIds, setDraftSelectedPlexUserIds] = useState<
    string[]
  >([]);
  const plexLibrariesQuery = useQuery({
    queryKey: ['integrations', 'plex', 'libraries'],
    queryFn: getPlexLibraries,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  useEffect(() => {
    if (!plexLibrariesQuery.data) return;
    const timeout = window.setTimeout(() => {
      setDraftSelectedPlexLibraryKeys(plexLibrariesQuery.data.selectedSectionKeys);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [plexLibrariesQuery.data]);

  const plexMonitoringUsersQuery = useQuery({
    queryKey: ['integrations', 'plex', 'monitoring-users'],
    queryFn: getPlexMonitoringUsers,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  useEffect(() => {
    if (!plexMonitoringUsersQuery.data) return;
    const timeout = window.setTimeout(() => {
      setDraftSelectedPlexUserIds(plexMonitoringUsersQuery.data.selectedPlexUserIds);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [plexMonitoringUsersQuery.data]);

  const immaculateCollectionsQuery = useQuery({
    queryKey: ['immaculateTaste', 'collections'],
    queryFn: getImmaculateTasteCollections,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const immaculateUsersQuery = useQuery({
    queryKey: ['immaculateTaste', 'users'],
    queryFn: getImmaculateTasteUserSummary,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const resetImmaculateMutation = useMutation({
    mutationFn: resetImmaculateTasteCollection,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'collections'] });
      void queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'users'] });
    },
  });

  const resetImmaculateUserMutation = useMutation({
    mutationFn: resetImmaculateTasteUserCollection,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'collections'] });
      void queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'users'] });
      toast.success(
        `${data.plexUserTitle} ${data.mediaType === 'movie' ? 'movie' : 'TV'} collections reset (${data.dataset.deleted} entries removed).`,
      );
    },
  });

  const resetRejectedMutation = useMutation({
    mutationFn: resetRejectedSuggestions,
    onSuccess: (data) => {
      toast.success(`Rejected list reset (${data.deleted} removed).`);
      // Observatory pages should refresh their decks next time they mount.
      void queryClient.invalidateQueries({ queryKey: ['observatory'] });
    },
  });

  const resetSeerrMutation = useMutation({
    mutationFn: resetSeerrRequests,
    onSuccess: (data) => {
      if (data.failed > 0) {
        toast.error(
          `Seerr reset finished with ${data.failed} failed request deletions (${data.deleted} removed).`,
        );
        return;
      }
      toast.success(`Seerr requests reset (${data.deleted} removed).`);
    },
  });

  const rejectedListQuery = useQuery({
    queryKey: ['observatory', 'rejected'],
    queryFn: listRejectedSuggestions,
    enabled: rejectedListOpen,
    staleTime: 0,
    retry: 1,
  });

  const deleteRejectedMutation = useMutation({
    mutationFn: async (id: string) => await deleteRejectedSuggestion(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['observatory', 'rejected'] });
    },
  });

  const filteredRejectedItems = useMemo<RejectedSuggestionItem[]>(() => {
    const items = rejectedListQuery.data?.items ?? [];
    return items
      .filter((i) => i.mediaType === rejectedMediaTab)
      .filter((i) => (rejectedKind === 'all' ? true : i.collectionKind === rejectedKind));
  }, [rejectedListQuery.data?.items, rejectedMediaTab, rejectedKind]);

  const immaculateUsers = immaculateUsersQuery.data?.users ?? [];
  const adminImmaculateUser =
    immaculateUsers.find((user) => user.isAdmin) ?? immaculateUsers[0] ?? null;
  const nonAdminImmaculateUsers = immaculateUsers.filter((user) => !user.isAdmin);
  const hasMultipleImmaculateUsers = immaculateUsers.length > 1;

  const kindLabel = (k: RejectedSuggestionItem['collectionKind']) => {
    if (k === 'immaculateTaste') return 'Immaculate Taste';
    if (k === 'changeOfTaste') return 'Change of Taste';
    return 'Recently Watched';
  };

  const immaculateProfiles = useMemo(
    () => immaculateProfilesQuery.data?.profiles ?? [],
    [immaculateProfilesQuery.data?.profiles],
  );
  const profileScopeUsers = useMemo<PlexMonitoringUserItem[]>(() => {
    const users = plexMonitoringUsersQuery.data?.users ?? [];
    return users
      .slice()
      .sort((left, right) => {
        if (left.isAdmin !== right.isAdmin) return left.isAdmin ? -1 : 1;
        return left.plexAccountTitle.localeCompare(right.plexAccountTitle);
      });
  }, [plexMonitoringUsersQuery.data?.users]);
  const selectedCollectionArtworkUser = useMemo(
    () =>
      selectedCollectionArtworkUserId
        ? profileScopeUsers.find((user) => user.id === selectedCollectionArtworkUserId) ??
          null
        : null,
    [profileScopeUsers, selectedCollectionArtworkUserId],
  );
  const trimmedCollectionArtworkUserSearch = collectionArtworkUserSearch
    .trim()
    .toLowerCase();
  const collectionArtworkUserSearchResults = useMemo(() => {
    if (!trimmedCollectionArtworkUserSearch) {
      return profileScopeUsers.slice(0, 10);
    }
    return profileScopeUsers
      .filter((user) =>
        user.plexAccountTitle.toLowerCase().includes(trimmedCollectionArtworkUserSearch),
      )
      .slice(0, 12);
  }, [profileScopeUsers, trimmedCollectionArtworkUserSearch]);
  const collectionArtworkManagedTargetsQuery = useQuery({
    queryKey: ['collection-artwork', 'managed-collections', selectedCollectionArtworkUserId],
    queryFn: async () =>
      await getManagedCollectionArtworkTargets(selectedCollectionArtworkUserId ?? ''),
    enabled: Boolean(selectedCollectionArtworkUserId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const collectionArtworkTargets = useMemo(
    () => collectionArtworkManagedTargetsQuery.data?.collections ?? [],
    [collectionArtworkManagedTargetsQuery.data?.collections],
  );
  const selectedCollectionArtworkTarget = useMemo(
    () =>
      collectionArtworkTargets.find(
        (target) =>
          getCollectionArtworkTargetKey(target) === selectedCollectionArtworkTargetKey,
      ) ?? null,
    [collectionArtworkTargets, selectedCollectionArtworkTargetKey],
  );
  const collectionArtworkFlowActive = Boolean(
    selectedCollectionArtworkUserId || selectedCollectionArtworkTargetKey || collectionArtworkFile,
  );
  const selectedCollectionArtworkPreviewUrl = useMemo(() => {
    if (!selectedCollectionArtworkUserId || !selectedCollectionArtworkTarget?.hasCustomPoster) {
      return null;
    }
    return getCollectionArtworkPreviewUrl({
      plexUserId: selectedCollectionArtworkUserId,
      mediaType: selectedCollectionArtworkTarget.mediaType,
      targetKind: selectedCollectionArtworkTarget.targetKind,
      targetId: selectedCollectionArtworkTarget.targetId,
      updatedAt: selectedCollectionArtworkTarget.customPosterUpdatedAt,
    });
  }, [selectedCollectionArtworkTarget, selectedCollectionArtworkUserId]);
  useEffect(() => {
    if (!collectionArtworkPreviewOpen) return;
    if (!selectedCollectionArtworkTarget?.hasCustomPoster || !selectedCollectionArtworkPreviewUrl) {
      const timeout = window.setTimeout(() => {
        setCollectionArtworkPreviewOpen(false);
        setCollectionArtworkPreviewFailed(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [
    collectionArtworkPreviewOpen,
    selectedCollectionArtworkPreviewUrl,
    selectedCollectionArtworkTarget?.hasCustomPoster,
  ]);
  const saveCollectionArtworkOverrideMutation = useMutation({
    mutationFn: async () => {
      const plexUserId = selectedCollectionArtworkUserId ?? '';
      const target = selectedCollectionArtworkTarget;
      const file = collectionArtworkFile;
      if (!plexUserId || !target || !file) {
        throw new Error('Choose user, collection target, and poster file first.');
      }
      return await uploadCollectionArtworkOverride({
        plexUserId,
        mediaType: target.mediaType,
        targetKind: target.targetKind,
        targetId: target.targetId,
        file,
      });
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({
        queryKey: ['collection-artwork', 'managed-collections', selectedCollectionArtworkUserId],
      });
      setCollectionArtworkFile(null);
      if (collectionArtworkFileInputRef.current) {
        collectionArtworkFileInputRef.current.value = '';
      }
      if (data.appliedNow) {
        toast.success('Poster override saved and applied.');
      } else {
        toast.success('Poster override saved.');
      }
      if (data.warnings?.length) {
        toast.warning(data.warnings.join(' '));
      }
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(error.body, error.message || 'Failed to save poster override'),
        );
        return;
      }
      toast.error(
        error instanceof Error ? error.message : 'Failed to save poster override',
      );
    },
  });
  const resetCollectionArtworkOverrideMutation = useMutation({
    mutationFn: async () => {
      const plexUserId = selectedCollectionArtworkUserId ?? '';
      const target = selectedCollectionArtworkTarget;
      if (!plexUserId || !target) {
        throw new Error('Choose user and collection target first.');
      }
      return await deleteCollectionArtworkOverride({
        plexUserId,
        mediaType: target.mediaType,
        targetKind: target.targetKind,
        targetId: target.targetId,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['collection-artwork', 'managed-collections', selectedCollectionArtworkUserId],
      });
      toast.success('Custom poster reset. Default artwork will be used.');
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(error.body, error.message || 'Failed to reset poster override'),
        );
        return;
      }
      toast.error(
        error instanceof Error ? error.message : 'Failed to reset poster override',
      );
    },
  });
  const activeProfile = useMemo(
    () =>
      activeProfileId
        ? immaculateProfiles.find((profile) => profile.id === activeProfileId) ?? null
        : null,
    [activeProfileId, immaculateProfiles],
  );
  const monitoredProfileScopeUsers = useMemo(() => {
    const selectedPlexUserIds = plexMonitoringUsersQuery.data?.selectedPlexUserIds ?? [];
    if (!selectedPlexUserIds.length) return profileScopeUsers;
    const selectedPlexUserIdSet = new Set(selectedPlexUserIds);
    return profileScopeUsers.filter((user) => selectedPlexUserIdSet.has(user.id));
  }, [plexMonitoringUsersQuery.data?.selectedPlexUserIds, profileScopeUsers]);
  const activeProfileDeleteImpact = useMemo<ProfileDeleteImpactSummary | null>(() => {
    if (!activeProfile || activeProfile.isDefault) return null;

    const otherEnabledProfiles = immaculateProfiles.filter(
      (profile) => profile.id !== activeProfile.id && profile.enabled,
    );
    const uniqueCollectionNames = new Set<string>();
    const sharedCollectionNames = new Set<string>();

    if (!monitoredProfileScopeUsers.length) {
      const baseScope = resolveEffectiveProfileScopeForPlexUser({
        profile: activeProfile,
        plexUserId: null,
      });
      if (baseScope && mediaTypeIncludesMovie(baseScope.mediaType)) {
        const collectionName = baseScope.movieCollectionBaseName;
        const isShared = otherEnabledProfiles.some((profile) =>
          profileUsesCollectionBaseName({
            profile,
            mediaType: 'movie',
            collectionBaseName: baseScope.movieCollectionBaseName,
          }),
        );
        if (isShared) {
          sharedCollectionNames.add(collectionName);
        } else {
          uniqueCollectionNames.add(collectionName);
        }
      }
      if (baseScope && mediaTypeIncludesShow(baseScope.mediaType)) {
        const collectionName = baseScope.showCollectionBaseName;
        const isShared = otherEnabledProfiles.some((profile) =>
          profileUsesCollectionBaseName({
            profile,
            mediaType: 'show',
            collectionBaseName: baseScope.showCollectionBaseName,
          }),
        );
        if (isShared) {
          sharedCollectionNames.add(collectionName);
        } else {
          uniqueCollectionNames.add(collectionName);
        }
      }
    } else {
      for (const user of monitoredProfileScopeUsers) {
        const scope = resolveEffectiveProfileScopeForPlexUser({
          profile: activeProfile,
          plexUserId: user.id,
        });
        if (!scope) continue;
        if (mediaTypeIncludesMovie(scope.mediaType)) {
          const collectionName = buildImmaculateCollectionName(
            scope.movieCollectionBaseName,
            user.plexAccountTitle,
          );
          const targetMovieBaseKey = normalizeCollectionBaseName(
            scope.movieCollectionBaseName,
          );
          const isShared = otherEnabledProfiles.some((profile) => {
            const candidateScope = resolveEffectiveProfileScopeForPlexUser({
              profile,
              plexUserId: user.id,
            });
            if (!candidateScope) return false;
            if (!mediaTypeIncludesMovie(candidateScope.mediaType)) return false;
            return (
              normalizeCollectionBaseName(candidateScope.movieCollectionBaseName) ===
              targetMovieBaseKey
            );
          });
          if (isShared) {
            sharedCollectionNames.add(collectionName);
          } else {
            uniqueCollectionNames.add(collectionName);
          }
        }
        if (mediaTypeIncludesShow(scope.mediaType)) {
          const collectionName = buildImmaculateCollectionName(
            scope.showCollectionBaseName,
            user.plexAccountTitle,
          );
          const targetShowBaseKey = normalizeCollectionBaseName(
            scope.showCollectionBaseName,
          );
          const isShared = otherEnabledProfiles.some((profile) => {
            const candidateScope = resolveEffectiveProfileScopeForPlexUser({
              profile,
              plexUserId: user.id,
            });
            if (!candidateScope) return false;
            if (!mediaTypeIncludesShow(candidateScope.mediaType)) return false;
            return (
              normalizeCollectionBaseName(candidateScope.showCollectionBaseName) ===
              targetShowBaseKey
            );
          });
          if (isShared) {
            sharedCollectionNames.add(collectionName);
          } else {
            uniqueCollectionNames.add(collectionName);
          }
        }
      }
    }

    const defaultWillAutoEnable =
      activeProfile.enabled &&
      !immaculateProfiles.some(
        (profile) => profile.id !== activeProfile.id && profile.enabled,
      );

    return {
      uniqueCollectionNames: Array.from(uniqueCollectionNames).sort((left, right) =>
        left.localeCompare(right),
      ),
      sharedCollectionNames: Array.from(sharedCollectionNames).sort((left, right) =>
        left.localeCompare(right),
      ),
      defaultWillAutoEnable,
    };
  }, [activeProfile, immaculateProfiles, monitoredProfileScopeUsers]);
  const activeProfileScopeOverride = useMemo(
    () => findProfileUserOverride(activeProfile, activeProfileScopePlexUserId),
    [activeProfile, activeProfileScopePlexUserId],
  );
  const activeProfileOverrideUserIds = useMemo(
    () => new Set((activeProfile?.userOverrides ?? []).map((override) => override.plexUserId)),
    [activeProfile],
  );
  const profileScopeSelectedUsers = useMemo(
    () =>
      profileScopeUsers.filter((user) =>
        activeProfileOverrideUserIds.has(user.id),
      ),
    [activeProfileOverrideUserIds, profileScopeUsers],
  );
  const trimmedProfileScopeSearch = profileScopeSearch.trim().toLowerCase();
  const profileScopeSearchResults = useMemo(() => {
    const nonPinnedUsers = profileScopeUsers.filter(
      (user) => !activeProfileOverrideUserIds.has(user.id),
    );
    const matchingUsers = (trimmedProfileScopeSearch
      ? nonPinnedUsers.filter((user) =>
          user.plexAccountTitle.toLowerCase().includes(trimmedProfileScopeSearch),
        )
      : nonPinnedUsers
    ).slice();
    matchingUsers.sort((left, right) =>
      left.plexAccountTitle.localeCompare(right.plexAccountTitle),
    );
    return matchingUsers.slice(0, trimmedProfileScopeSearch ? 12 : 10);
  }, [activeProfileOverrideUserIds, profileScopeUsers, trimmedProfileScopeSearch]);
  const trimmedNewProfileScopeSearch = newProfileScopeSearch.trim().toLowerCase();
  const newProfileScopeUserIdSet = useMemo(
    () => new Set(newProfileScopePlexUserIds),
    [newProfileScopePlexUserIds],
  );
  const newProfileScopeSelectedUsers = useMemo(
    () =>
      profileScopeUsers.filter((user) =>
        newProfileScopeUserIdSet.has(user.id),
      ),
    [newProfileScopeUserIdSet, profileScopeUsers],
  );
  const newProfileScopeSearchResults = useMemo(() => {
    const availableUsers = profileScopeUsers.filter(
      (user) => !newProfileScopeUserIdSet.has(user.id),
    );
    const matchingUsers = (trimmedNewProfileScopeSearch
      ? availableUsers.filter((user) =>
          user.plexAccountTitle.toLowerCase().includes(trimmedNewProfileScopeSearch),
        )
      : availableUsers
    ).slice();
    matchingUsers.sort((left, right) =>
      left.plexAccountTitle.localeCompare(right.plexAccountTitle),
    );
    return matchingUsers.slice(0, trimmedNewProfileScopeSearch ? 12 : 10);
  }, [newProfileScopeUserIdSet, profileScopeUsers, trimmedNewProfileScopeSearch]);
  const radarrInstanceOptions = useMemo(
    () =>
      (arrInstancesQuery.data?.instances ?? [])
        .filter((instance) => instance.type === 'radarr')
        .slice()
        .sort((a, b) => {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name);
        }),
    [arrInstancesQuery.data?.instances],
  );
  const sonarrInstanceOptions = useMemo(
    () =>
      (arrInstancesQuery.data?.instances ?? [])
        .filter((instance) => instance.type === 'sonarr')
        .slice()
        .sort((a, b) => {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name);
        }),
    [arrInstancesQuery.data?.instances],
  );
  const activeRadarrInstanceOptions = useMemo(
    () => radarrInstanceOptions.filter((instance) => instance.enabled),
    [radarrInstanceOptions],
  );
  const activeSonarrInstanceOptions = useMemo(
    () => sonarrInstanceOptions.filter((instance) => instance.enabled),
    [sonarrInstanceOptions],
  );
  const hasMultipleActiveRadarrServices = activeRadarrInstanceOptions.length >= 2;
  const hasMultipleActiveSonarrServices = activeSonarrInstanceOptions.length >= 2;
  const enabledSecondaryRadarrInstances = useMemo(
    () => activeRadarrInstanceOptions.filter((instance) => !instance.isPrimary),
    [activeRadarrInstanceOptions],
  );
  const enabledSecondarySonarrInstances = useMemo(
    () => activeSonarrInstanceOptions.filter((instance) => !instance.isPrimary),
    [activeSonarrInstanceOptions],
  );
  const showRadarrStackedDefaults = enabledSecondaryRadarrInstances.length > 0;
  const showSonarrStackedDefaults = enabledSecondarySonarrInstances.length > 0;
  const radarrSecondaryOptionsQueries = useQueries({
    queries: enabledSecondaryRadarrInstances.map((instance) => ({
      queryKey: ['integrations', 'radarr', 'options', instance.id] as const,
      queryFn: () => getRadarrOptionsForInstance(instance.id),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  }) as UseQueryResult<RadarrOptionsResponse, Error>[];
  const sonarrSecondaryOptionsQueries = useQueries({
    queries: enabledSecondarySonarrInstances.map((instance) => ({
      queryKey: ['integrations', 'sonarr', 'options', instance.id] as const,
      queryFn: () => getSonarrOptionsForInstance(instance.id),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  }) as UseQueryResult<SonarrOptionsResponse, Error>[];
  const recommendedGenres = useMemo(
    () => plexLibraryFiltersQuery.data?.genres ?? [],
    [plexLibraryFiltersQuery.data?.genres],
  );
  const trimmedGenreSearch = genreSearch.trim();
  const genreSearchIsActive = trimmedGenreSearch.length > 0;
  const rankedGenreOptions = useMemo(
    () => dedupeCaseInsensitive(recommendedGenres),
    [recommendedGenres],
  );
  const selectedGenres = useMemo(
    () => normalizeCsvStringList(profileDraft?.includeGenresText ?? ''),
    [profileDraft?.includeGenresText],
  );
  const selectedGenreSet = useMemo(
    () => new Set(selectedGenres.map((item) => item.toLowerCase())),
    [selectedGenres],
  );
  const defaultGenreOptions = useMemo(
    () =>
      rankedGenreOptions
        .filter((genre) => !selectedGenreSet.has(genre.toLowerCase()))
        .slice(0, 10),
    [rankedGenreOptions, selectedGenreSet],
  );
  const filteredGenreOptions = useMemo(() => {
    const query = trimmedGenreSearch.toLowerCase();
    if (!query) return [];
    return rankedGenreOptions
      .filter((genre) => !selectedGenreSet.has(genre.toLowerCase()))
      .filter((genre) => genre.toLowerCase().includes(query))
      .slice(0, 12);
  }, [rankedGenreOptions, selectedGenreSet, trimmedGenreSearch]);
  const trimmedExcludeGenreSearch = excludeGenreSearch.trim();
  const excludeGenreSearchIsActive = trimmedExcludeGenreSearch.length > 0;
  const selectedExcludedGenres = useMemo(
    () => normalizeCsvStringList(profileDraft?.excludeGenresText ?? ''),
    [profileDraft?.excludeGenresText],
  );
  const selectedExcludedGenreSet = useMemo(
    () => new Set(selectedExcludedGenres.map((item) => item.toLowerCase())),
    [selectedExcludedGenres],
  );
  const defaultExcludedGenreOptions = useMemo(
    () =>
      rankedGenreOptions
        .filter((genre) => !selectedExcludedGenreSet.has(genre.toLowerCase()))
        .slice(0, 10),
    [rankedGenreOptions, selectedExcludedGenreSet],
  );
  const filteredExcludedGenreOptions = useMemo(() => {
    const query = trimmedExcludeGenreSearch.toLowerCase();
    if (!query) return [];
    return rankedGenreOptions
      .filter((genre) => !selectedExcludedGenreSet.has(genre.toLowerCase()))
      .filter((genre) => genre.toLowerCase().includes(query))
      .slice(0, 12);
  }, [rankedGenreOptions, selectedExcludedGenreSet, trimmedExcludeGenreSearch]);
  const trimmedNewProfileGenreSearch = newProfileGenreSearch.trim();
  const newProfileGenreSearchIsActive = trimmedNewProfileGenreSearch.length > 0;
  const newProfileSelectedGenres = useMemo(
    () => normalizeCsvStringList(newProfileDraft?.includeGenresText ?? ''),
    [newProfileDraft?.includeGenresText],
  );
  const newProfileSelectedGenreSet = useMemo(
    () => new Set(newProfileSelectedGenres.map((item) => item.toLowerCase())),
    [newProfileSelectedGenres],
  );
  const newProfileDefaultGenreOptions = useMemo(
    () =>
      rankedGenreOptions
        .filter((genre) => !newProfileSelectedGenreSet.has(genre.toLowerCase()))
        .slice(0, 10),
    [rankedGenreOptions, newProfileSelectedGenreSet],
  );
  const newProfileFilteredGenreOptions = useMemo(() => {
    const query = trimmedNewProfileGenreSearch.toLowerCase();
    if (!query) return [];
    return rankedGenreOptions
      .filter((genre) => !newProfileSelectedGenreSet.has(genre.toLowerCase()))
      .filter((genre) => genre.toLowerCase().includes(query))
      .slice(0, 12);
  }, [rankedGenreOptions, newProfileSelectedGenreSet, trimmedNewProfileGenreSearch]);
  const trimmedNewProfileExcludeGenreSearch = newProfileExcludeGenreSearch.trim();
  const newProfileExcludeGenreSearchIsActive =
    trimmedNewProfileExcludeGenreSearch.length > 0;
  const newProfileSelectedExcludedGenres = useMemo(
    () => normalizeCsvStringList(newProfileDraft?.excludeGenresText ?? ''),
    [newProfileDraft?.excludeGenresText],
  );
  const newProfileSelectedExcludedGenreSet = useMemo(
    () => new Set(newProfileSelectedExcludedGenres.map((item) => item.toLowerCase())),
    [newProfileSelectedExcludedGenres],
  );
  const newProfileDefaultExcludedGenreOptions = useMemo(
    () =>
      rankedGenreOptions
        .filter((genre) => !newProfileSelectedExcludedGenreSet.has(genre.toLowerCase()))
        .slice(0, 10),
    [rankedGenreOptions, newProfileSelectedExcludedGenreSet],
  );
  const newProfileFilteredExcludedGenreOptions = useMemo(() => {
    const query = trimmedNewProfileExcludeGenreSearch.toLowerCase();
    if (!query) return [];
    return rankedGenreOptions
      .filter((genre) => !newProfileSelectedExcludedGenreSet.has(genre.toLowerCase()))
      .filter((genre) => genre.toLowerCase().includes(query))
      .slice(0, 12);
  }, [
    rankedGenreOptions,
    newProfileSelectedExcludedGenreSet,
    trimmedNewProfileExcludeGenreSearch,
  ]);
  const recommendedAudioLanguages = useMemo(
    () => plexLibraryFiltersQuery.data?.audioLanguages ?? [],
    [plexLibraryFiltersQuery.data?.audioLanguages],
  );
  const trimmedAudioLanguageSearch = audioLanguageSearch.trim();
  const audioLanguageSearchIsActive = trimmedAudioLanguageSearch.length > 0;
  const rankedAudioLanguageOptions = useMemo(
    () =>
      dedupeCaseInsensitive([
        ...TOP_10_POPULAR_AUDIO_LANGUAGES,
        ...recommendedAudioLanguages,
      ]),
    [recommendedAudioLanguages],
  );
  const selectedAudioLanguages = useMemo(
    () => normalizeCsvStringList(profileDraft?.includeAudioLanguagesText ?? ''),
    [profileDraft?.includeAudioLanguagesText],
  );
  const selectedAudioLanguageSet = useMemo(
    () =>
      new Set(selectedAudioLanguages.map((item) => item.toLowerCase())),
    [selectedAudioLanguages],
  );
  const defaultAudioLanguageOptions = useMemo(
    () =>
      TOP_10_POPULAR_AUDIO_LANGUAGES.filter(
        (language) => !selectedAudioLanguageSet.has(language.toLowerCase()),
      ),
    [selectedAudioLanguageSet],
  );
  const filteredAudioLanguageOptions = useMemo(() => {
    const query = trimmedAudioLanguageSearch.toLowerCase();
    if (!query) return [];
    const available = rankedAudioLanguageOptions.filter(
      (language) => !selectedAudioLanguageSet.has(language.toLowerCase()),
    );
    return available
      .filter((language) => language.toLowerCase().includes(query))
      .slice(0, 12);
  }, [rankedAudioLanguageOptions, selectedAudioLanguageSet, trimmedAudioLanguageSearch]);
  const trimmedExcludeAudioLanguageSearch = excludeAudioLanguageSearch.trim();
  const excludeAudioLanguageSearchIsActive =
    trimmedExcludeAudioLanguageSearch.length > 0;
  const selectedExcludedAudioLanguages = useMemo(
    () => normalizeCsvStringList(profileDraft?.excludeAudioLanguagesText ?? ''),
    [profileDraft?.excludeAudioLanguagesText],
  );
  const selectedExcludedAudioLanguageSet = useMemo(
    () => new Set(selectedExcludedAudioLanguages.map((item) => item.toLowerCase())),
    [selectedExcludedAudioLanguages],
  );
  const defaultExcludedAudioLanguageOptions = useMemo(
    () =>
      TOP_10_POPULAR_AUDIO_LANGUAGES.filter(
        (language) => !selectedExcludedAudioLanguageSet.has(language.toLowerCase()),
      ),
    [selectedExcludedAudioLanguageSet],
  );
  const filteredExcludedAudioLanguageOptions = useMemo(() => {
    const query = trimmedExcludeAudioLanguageSearch.toLowerCase();
    if (!query) return [];
    const available = rankedAudioLanguageOptions.filter(
      (language) => !selectedExcludedAudioLanguageSet.has(language.toLowerCase()),
    );
    return available
      .filter((language) => language.toLowerCase().includes(query))
      .slice(0, 12);
  }, [
    rankedAudioLanguageOptions,
    selectedExcludedAudioLanguageSet,
    trimmedExcludeAudioLanguageSearch,
  ]);
  const trimmedNewProfileAudioLanguageSearch = newProfileAudioLanguageSearch.trim();
  const newProfileAudioLanguageSearchIsActive =
    trimmedNewProfileAudioLanguageSearch.length > 0;
  const newProfileSelectedAudioLanguages = useMemo(
    () => normalizeCsvStringList(newProfileDraft?.includeAudioLanguagesText ?? ''),
    [newProfileDraft?.includeAudioLanguagesText],
  );
  const newProfileSelectedAudioLanguageSet = useMemo(
    () => new Set(newProfileSelectedAudioLanguages.map((item) => item.toLowerCase())),
    [newProfileSelectedAudioLanguages],
  );
  const newProfileDefaultAudioLanguageOptions = useMemo(
    () =>
      TOP_10_POPULAR_AUDIO_LANGUAGES.filter(
        (language) => !newProfileSelectedAudioLanguageSet.has(language.toLowerCase()),
      ),
    [newProfileSelectedAudioLanguageSet],
  );
  const newProfileFilteredAudioLanguageOptions = useMemo(() => {
    const query = trimmedNewProfileAudioLanguageSearch.toLowerCase();
    if (!query) return [];
    const available = rankedAudioLanguageOptions.filter(
      (language) => !newProfileSelectedAudioLanguageSet.has(language.toLowerCase()),
    );
    return available
      .filter((language) => language.toLowerCase().includes(query))
      .slice(0, 12);
  }, [
    rankedAudioLanguageOptions,
    newProfileSelectedAudioLanguageSet,
    trimmedNewProfileAudioLanguageSearch,
  ]);
  const trimmedNewProfileExcludeAudioLanguageSearch =
    newProfileExcludeAudioLanguageSearch.trim();
  const newProfileExcludeAudioLanguageSearchIsActive =
    trimmedNewProfileExcludeAudioLanguageSearch.length > 0;
  const newProfileSelectedExcludedAudioLanguages = useMemo(
    () => normalizeCsvStringList(newProfileDraft?.excludeAudioLanguagesText ?? ''),
    [newProfileDraft?.excludeAudioLanguagesText],
  );
  const newProfileSelectedExcludedAudioLanguageSet = useMemo(
    () =>
      new Set(newProfileSelectedExcludedAudioLanguages.map((item) => item.toLowerCase())),
    [newProfileSelectedExcludedAudioLanguages],
  );
  const newProfileDefaultExcludedAudioLanguageOptions = useMemo(
    () =>
      TOP_10_POPULAR_AUDIO_LANGUAGES.filter(
        (language) =>
          !newProfileSelectedExcludedAudioLanguageSet.has(language.toLowerCase()),
      ),
    [newProfileSelectedExcludedAudioLanguageSet],
  );
  const newProfileFilteredExcludedAudioLanguageOptions = useMemo(() => {
    const query = trimmedNewProfileExcludeAudioLanguageSearch.toLowerCase();
    if (!query) return [];
    const available = rankedAudioLanguageOptions.filter(
      (language) =>
        !newProfileSelectedExcludedAudioLanguageSet.has(language.toLowerCase()),
    );
    return available
      .filter((language) => language.toLowerCase().includes(query))
      .slice(0, 12);
  }, [
    rankedAudioLanguageOptions,
    newProfileSelectedExcludedAudioLanguageSet,
    trimmedNewProfileExcludeAudioLanguageSearch,
  ]);
  const profileWantsMovies =
    profileDraft?.mediaType === 'movie' || profileDraft?.mediaType === 'both';
  const profileWantsShows =
    profileDraft?.mediaType === 'show' || profileDraft?.mediaType === 'both';
  const showRadarrServiceSelector =
    profileWantsMovies && hasMultipleActiveRadarrServices;
  const showSonarrServiceSelector =
    profileWantsShows && hasMultipleActiveSonarrServices;
  const newProfileWantsMovies =
    newProfileDraft?.mediaType === 'movie' || newProfileDraft?.mediaType === 'both';
  const newProfileWantsShows =
    newProfileDraft?.mediaType === 'show' || newProfileDraft?.mediaType === 'both';
  const showNewProfileRadarrServiceSelector =
    newProfileWantsMovies && hasMultipleActiveRadarrServices;
  const showNewProfileSonarrServiceSelector =
    newProfileWantsShows && hasMultipleActiveSonarrServices;

  useEffect(() => {
    if (!immaculateProfiles.length) {
      const timeout = window.setTimeout(() => {
        setActiveProfileId(null);
        setActiveProfileScopePlexUserId(null);
        setProfileScopeSearch('');
        setProfileDraft(null);
        setIsProfileEditorOpen(false);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (!activeProfileId) {
      const first = immaculateProfiles[0];
      const timeout = window.setTimeout(() => {
        setActiveProfileId(first.id);
        setActiveProfileScopePlexUserId(null);
        setProfileDraft(toProfileDraft(first));
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    const existing = immaculateProfiles.find((profile) => profile.id === activeProfileId);
    if (!existing) {
      const first = immaculateProfiles[0];
      const timeout = window.setTimeout(() => {
        setActiveProfileId(first.id);
        setActiveProfileScopePlexUserId(null);
        setProfileDraft(toProfileDraft(first));
      }, 0);
      return () => window.clearTimeout(timeout);
    }
    if (!profileDraft) {
      const activeOverride = findProfileUserOverride(existing, activeProfileScopePlexUserId);
      const timeout = window.setTimeout(() => {
        setProfileDraft(toProfileDraft(existing, activeOverride));
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [activeProfileId, activeProfileScopePlexUserId, immaculateProfiles, profileDraft]);
  const normalizeProfileServiceSelection = useCallback(
    (draft: ImmaculateTasteProfileDraft) => {
      const wantsMovies = draft.mediaType === 'movie' || draft.mediaType === 'both';
      const wantsShows = draft.mediaType === 'show' || draft.mediaType === 'both';
      const selectedRadarrInstanceId =
        draft.radarrInstanceId === PRIMARY_INSTANCE_SENTINEL
          ? null
          : draft.radarrInstanceId || null;
      const selectedSonarrInstanceId =
        draft.sonarrInstanceId === PRIMARY_INSTANCE_SENTINEL
          ? null
          : draft.sonarrInstanceId || null;
      return {
        radarrInstanceId:
          wantsMovies && hasMultipleActiveRadarrServices
            ? selectedRadarrInstanceId
            : null,
        sonarrInstanceId:
          wantsShows && hasMultipleActiveSonarrServices
            ? selectedSonarrInstanceId
            : null,
      };
    },
    [hasMultipleActiveRadarrServices, hasMultipleActiveSonarrServices],
  );

  const createImmaculateProfileMutation = useMutation({
    mutationFn: async (params: {
      draft: ImmaculateTasteProfileDraft;
      scopePlexUserIds: string[];
    }) => {
      const normalizedServiceSelection = normalizeProfileServiceSelection(params.draft);
      const normalizedFilters = resolveProfileDraftFilters(params.draft);
      const payload = {
        name: params.draft.name.trim(),
        enabled: params.draft.enabled,
        mediaType: params.draft.mediaType,
        matchMode: params.draft.matchMode,
        genres: normalizedFilters.includedGenres,
        audioLanguages: normalizedFilters.includedAudioLanguages,
        excludedGenres: normalizedFilters.excludedGenres,
        excludedAudioLanguages: normalizedFilters.excludedAudioLanguages,
        radarrInstanceId: normalizedServiceSelection.radarrInstanceId,
        sonarrInstanceId: normalizedServiceSelection.sonarrInstanceId,
        movieCollectionBaseName: params.draft.movieCollectionBaseName.trim() || null,
        showCollectionBaseName: params.draft.showCollectionBaseName.trim() || null,
      };
      const created = await createImmaculateTasteProfile(payload);
      const scopePlexUserIds = Array.from(
        new Set(
          params.scopePlexUserIds
            .map((plexUserId) => plexUserId.trim())
            .filter((plexUserId) => Boolean(plexUserId)),
        ),
      );
      if (!scopePlexUserIds.length) {
        return {
          profile: created.profile,
          scopedUserFailures: [] as string[],
        };
      }
      let latestProfile = created.profile;
      const scopedUserFailures: string[] = [];
      for (const scopePlexUserId of scopePlexUserIds) {
        try {
          const updated = await updateImmaculateTasteProfile(created.profile.id, {
            scopePlexUserId,
          });
          latestProfile = updated.profile;
        } catch {
          scopedUserFailures.push(scopePlexUserId);
        }
      }
      return {
        profile: latestProfile,
        scopedUserFailures,
      };
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'profiles'] });
      setNewProfileDraft(null);
      setNewProfileScopePlexUserIds([]);
      setNewProfileScopeSearch('');
      setNewProfileGenreSearch('');
      setNewProfileAudioLanguageSearch('');
      setNewProfileExcludeGenreSearch('');
      setNewProfileExcludeAudioLanguageSearch('');
      setActiveProfileId(data.profile.id);
      setActiveProfileScopePlexUserId(null);
      setProfileScopeSearch('');
      setProfileDraft(toProfileDraft(data.profile));
      setIsAddProfileFormOpen(false);
      setIsProfileEditorOpen(true);
      toast.success(`Profile "${data.profile.name}" created.`);
      if (data.scopedUserFailures.length > 0) {
        toast.warning(
          'Profile was created, but some selected users were not added to scope. Add them again from User scope.',
        );
      }
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(error.body, error.message || 'Failed to create profile'),
        );
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to create profile');
    },
  });

  const saveImmaculateProfileMutation = useMutation({
    mutationFn: async (params: {
      id: string;
      draft: ImmaculateTasteProfileDraft;
      scopePlexUserId: string | null;
      resetScopeToDefaultNaming?: boolean;
    }) => {
      const normalizedServiceSelection = normalizeProfileServiceSelection(params.draft);
      const normalizedFilters = resolveProfileDraftFilters(params.draft);
      const payload: Parameters<typeof updateImmaculateTasteProfile>[1] = {
        ...(params.scopePlexUserId
          ? { scopePlexUserId: params.scopePlexUserId }
          : {
              name: params.draft.name.trim(),
              enabled: params.draft.enabled,
            }),
        ...(params.resetScopeToDefaultNaming
          ? { resetScopeToDefaultNaming: true }
          : {}),
        mediaType: params.draft.mediaType,
        matchMode: params.draft.matchMode,
        genres: normalizedFilters.includedGenres,
        audioLanguages: normalizedFilters.includedAudioLanguages,
        excludedGenres: normalizedFilters.excludedGenres,
        excludedAudioLanguages: normalizedFilters.excludedAudioLanguages,
        radarrInstanceId: normalizedServiceSelection.radarrInstanceId,
        sonarrInstanceId: normalizedServiceSelection.sonarrInstanceId,
        movieCollectionBaseName: params.draft.movieCollectionBaseName.trim() || null,
        showCollectionBaseName: params.draft.showCollectionBaseName.trim() || null,
      };
      return await updateImmaculateTasteProfile(params.id, payload);
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'profiles'] });
      const scopedOverride = findProfileUserOverride(
        data.profile,
        variables.scopePlexUserId,
      );
      const submittedFilters = resolveProfileDraftFilters(variables.draft);
      const nextDraft = toProfileDraft(data.profile, scopedOverride);
      const persistedFilters = resolveProfileDraftFilters(nextDraft);
      const filtersPersisted =
        areCaseInsensitiveListsEqual(
          submittedFilters.includedGenres,
          persistedFilters.includedGenres,
        ) &&
        areCaseInsensitiveListsEqual(
          submittedFilters.includedAudioLanguages,
          persistedFilters.includedAudioLanguages,
        ) &&
        areCaseInsensitiveListsEqual(
          submittedFilters.excludedGenres,
          persistedFilters.excludedGenres,
        ) &&
        areCaseInsensitiveListsEqual(
          submittedFilters.excludedAudioLanguages,
          persistedFilters.excludedAudioLanguages,
        );
      if (!filtersPersisted) {
        setProfileDraft(variables.draft);
        toast.error(
          'Profile save did not persist the latest include/exclude filters. Restart API and apply the latest DB migration, then save again.',
        );
        return;
      }
      setProfileDraft(nextDraft);
      toast.success(`Profile "${data.profile.name}" saved.`);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(error.body, error.message || 'Failed to save profile'),
        );
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to save profile');
    },
  });

  const updateProfileScopeMutation = useMutation({
    mutationFn: async (params: {
      profileId: string;
      plexUserId: string;
      action: 'add' | 'remove';
    }) => {
      const profileId = params.profileId.trim();
      const plexUserId = params.plexUserId.trim();
      if (!profileId || !plexUserId) {
        throw new Error('Profile and Plex user are required to update user scope.');
      }
      if (params.action === 'remove') {
        return await updateImmaculateTasteProfile(profileId, {
          scopePlexUserId: plexUserId,
          resetScopeToDefaultNaming: true,
        });
      }
      return await updateImmaculateTasteProfile(profileId, {
        scopePlexUserId: plexUserId,
      });
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'profiles'] });
      if (activeProfileId === data.profile.id) {
        const normalizedPlexUserId = variables.plexUserId.trim();
        if (variables.action === 'add') {
          const scopedOverride = findProfileUserOverride(
            data.profile,
            normalizedPlexUserId,
          );
          setActiveProfileScopePlexUserId(normalizedPlexUserId);
          setProfileDraft(toProfileDraft(data.profile, scopedOverride));
        } else {
          const nextScopePlexUserId =
            activeProfileScopePlexUserId === normalizedPlexUserId
              ? null
              : activeProfileScopePlexUserId;
          const scopedOverride = findProfileUserOverride(
            data.profile,
            nextScopePlexUserId,
          );
          setActiveProfileScopePlexUserId(nextScopePlexUserId);
          setProfileDraft(toProfileDraft(data.profile, scopedOverride));
        }
      }
      toast.success(
        variables.action === 'add'
          ? 'User added to profile scope.'
          : 'User removed from profile scope.',
      );
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(error.body, error.message || 'Failed to update user scope'),
        );
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to update user scope');
    },
  });

  const toggleImmaculateProfileEnabledMutation = useMutation({
    mutationFn: async (params: { id: string; enabled: boolean }) => {
      return await updateImmaculateTasteProfile(params.id, {
        enabled: params.enabled,
      });
    },
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'profiles'] });
      if (activeProfileId === variables.id && !activeProfileScopePlexUserId) {
        setProfileDraft((current) =>
          current ? { ...current, enabled: data.profile.enabled } : current,
        );
      }
      toast.success(
        `Profile "${data.profile.name}" ${data.profile.enabled ? 'enabled' : 'disabled'}.`,
      );
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(error.body, error.message || 'Failed to update profile status'),
        );
        return;
      }
      toast.error(
        error instanceof Error ? error.message : 'Failed to update profile status',
      );
    },
  });

  const deleteImmaculateProfileMutation = useMutation({
    mutationFn: async (profile: ImmaculateTasteProfile) => {
      await deleteImmaculateTasteProfile(profile.id);
      return profile;
    },
    onSuccess: async (profile) => {
      await queryClient.invalidateQueries({ queryKey: ['immaculateTaste', 'profiles'] });
      setProfileDeleteDialogOpen(false);
      if (activeProfileId === profile.id) {
        setActiveProfileId(null);
        setActiveProfileScopePlexUserId(null);
        setProfileScopeSearch('');
        setProfileDraft(null);
        setIsProfileEditorOpen(false);
      }
      toast.success(`Profile "${profile.name}" deleted.`);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(error.body, error.message || 'Failed to delete profile'),
        );
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Failed to delete profile');
    },
  });

  const profileDirty = useMemo(() => {
    if (!activeProfile || !profileDraft) return false;
    const draftFilters = resolveProfileDraftFilters(profileDraft);
    const draftIncludedGenres = draftFilters.includedGenres;
    const draftIncludedAudioLanguages = draftFilters.includedAudioLanguages;
    const draftExcludedGenres = draftFilters.excludedGenres;
    const draftExcludedAudioLanguages = draftFilters.excludedAudioLanguages;
    const normalizedServiceSelection = normalizeProfileServiceSelection(profileDraft);
    const scopedOverride = findProfileUserOverride(activeProfile, activeProfileScopePlexUserId);
    const sourceMediaType = scopedOverride?.mediaType ?? activeProfile.mediaType;
    const sourceMatchMode = scopedOverride?.matchMode ?? activeProfile.matchMode;
    const sourceMovieCollectionBaseName =
      scopedOverride?.movieCollectionBaseName ?? activeProfile.movieCollectionBaseName;
    const sourceShowCollectionBaseName =
      scopedOverride?.showCollectionBaseName ?? activeProfile.showCollectionBaseName;
    const sourceRadarrInstanceId =
      scopedOverride?.radarrInstanceId ?? activeProfile.radarrInstanceId;
    const sourceSonarrInstanceId =
      scopedOverride?.sonarrInstanceId ?? activeProfile.sonarrInstanceId;
    const sourceGenres = scopedOverride?.genres ?? activeProfile.genres ?? [];
    const sourceAudioLanguages =
      scopedOverride?.audioLanguages ?? activeProfile.audioLanguages ?? [];
    const sourceExcludedGenres =
      scopedOverride?.excludedGenres ?? activeProfile.excludedGenres ?? [];
    const sourceExcludedAudioLanguages =
      scopedOverride?.excludedAudioLanguages ?? activeProfile.excludedAudioLanguages ?? [];
    return (
      (!activeProfileScopePlexUserId && activeProfile.name !== profileDraft.name.trim()) ||
      (!activeProfileScopePlexUserId && activeProfile.enabled !== profileDraft.enabled) ||
      sourceMediaType !== profileDraft.mediaType ||
      sourceMatchMode !== profileDraft.matchMode ||
      sourceMovieCollectionBaseName !==
        (profileDraft.movieCollectionBaseName.trim() || null) ||
      sourceShowCollectionBaseName !==
        (profileDraft.showCollectionBaseName.trim() || null) ||
      sourceRadarrInstanceId !== normalizedServiceSelection.radarrInstanceId ||
      sourceSonarrInstanceId !== normalizedServiceSelection.sonarrInstanceId ||
      JSON.stringify(sourceGenres) !== JSON.stringify(draftIncludedGenres) ||
      JSON.stringify(sourceAudioLanguages) !==
        JSON.stringify(draftIncludedAudioLanguages) ||
      JSON.stringify(sourceExcludedGenres) !== JSON.stringify(draftExcludedGenres) ||
      JSON.stringify(sourceExcludedAudioLanguages) !==
        JSON.stringify(draftExcludedAudioLanguages)
    );
  }, [
    activeProfile,
    activeProfileScopePlexUserId,
    normalizeProfileServiceSelection,
    profileDraft,
  ]);

  const defaultProfileAtNetZero = useMemo(() => {
    if (!activeProfile?.isDefault || !profileDraft || activeProfileScopePlexUserId) return false;
    const takenNames = new Set(
      immaculateProfiles
        .filter((profile) => profile.id !== activeProfile.id)
        .map((profile) => profile.name.trim().toLowerCase()),
    );
    const targetDefaultName =
      ['Default', 'Default profile'].find(
        (candidate) =>
          candidate.toLowerCase() === activeProfile.name.trim().toLowerCase() ||
          !takenNames.has(candidate.toLowerCase()),
      ) ?? activeProfile.name;
    return isNetZeroDefaultProfileDraft(profileDraft, targetDefaultName);
  }, [activeProfile, activeProfileScopePlexUserId, immaculateProfiles, profileDraft]);

  const selectImmaculateProfile = useCallback(
    (profile: ImmaculateTasteProfile) => {
      const isSameProfile = profile.id === activeProfileId;
      setActiveProfileId(profile.id);
      setActiveProfileScopePlexUserId(null);
      setProfileScopeSearch('');
      setProfileDraft(toProfileDraft(profile));
      setGenreSearch('');
      setAudioLanguageSearch('');
      setExcludeGenreSearch('');
      setExcludeAudioLanguageSearch('');
      setIsAddProfileFormOpen(false);
      setNewProfileDraft(null);
      setNewProfileScopePlexUserIds([]);
      setNewProfileScopeSearch('');
      setNewProfileGenreSearch('');
      setNewProfileAudioLanguageSearch('');
      setNewProfileExcludeGenreSearch('');
      setNewProfileExcludeAudioLanguageSearch('');
      setIsProfileEditorOpen((open) => (isSameProfile ? !open : true));
    },
    [activeProfileId],
  );

  const handleProfileEnabledToggle = useCallback(
    (profile: ImmaculateTasteProfile) => {
      const hasAnyOtherProfile = immaculateProfiles.some(
        (candidate) => candidate.id !== profile.id,
      );
      if (profile.isDefault && !hasAnyOtherProfile) return;

      const isEditingThisProfile =
        activeProfileId === profile.id && isProfileEditorOpen && Boolean(profileDraft);
      const currentEnabled =
        isEditingThisProfile && profileDraft ? profileDraft.enabled : profile.enabled;
      const hasEnabledFallback = immaculateProfiles.some(
        (candidate) => candidate.id !== profile.id && candidate.enabled,
      );
      if (profile.isDefault && currentEnabled && !hasEnabledFallback) return;
      const nextEnabled = !currentEnabled;
      const previousDraftEnabled =
        isEditingThisProfile && profileDraft ? profileDraft.enabled : null;

      if (isEditingThisProfile) {
        setProfileDraft((current) =>
          current ? { ...current, enabled: nextEnabled } : current,
        );
      }

      const profilesQueryKey = ['immaculateTaste', 'profiles'] as const;
      const previousProfilesResponse = queryClient.getQueryData<{
        ok: true;
        profiles: ImmaculateTasteProfile[];
      }>(profilesQueryKey);
      if (previousProfilesResponse) {
        const nextProfiles = previousProfilesResponse.profiles.map((candidate) =>
          candidate.id === profile.id ? { ...candidate, enabled: nextEnabled } : candidate,
        );
        const shouldEnableDefaultFallback =
          !nextEnabled &&
          !profile.isDefault &&
          !previousProfilesResponse.profiles.some(
            (candidate) => candidate.id !== profile.id && candidate.enabled,
          );
        const optimisticProfiles = shouldEnableDefaultFallback
          ? nextProfiles.map((candidate) =>
              candidate.isDefault ? { ...candidate, enabled: true } : candidate,
            )
          : nextProfiles;
        queryClient.setQueryData(profilesQueryKey, {
          ...previousProfilesResponse,
          profiles: optimisticProfiles,
        });
      }

      toggleImmaculateProfileEnabledMutation.mutate(
        { id: profile.id, enabled: nextEnabled },
        {
          onError: () => {
            if (previousDraftEnabled !== null) {
              setProfileDraft((current) =>
                current ? { ...current, enabled: previousDraftEnabled } : current,
              );
            }
            if (previousProfilesResponse) {
              queryClient.setQueryData(profilesQueryKey, previousProfilesResponse);
              return;
            }
            void queryClient.invalidateQueries({ queryKey: profilesQueryKey });
          },
        },
      );
    },
    [
      activeProfileId,
      immaculateProfiles,
      isProfileEditorOpen,
      profileDraft,
      queryClient,
      toggleImmaculateProfileEnabledMutation,
    ],
  );

  const resetProfileDraft = useCallback(() => {
    if (!activeProfile) return;
    if (activeProfileScopePlexUserId) {
      setProfileDraft(toProfileDraft(activeProfile));
      setGenreSearch('');
      setAudioLanguageSearch('');
      setExcludeGenreSearch('');
      setExcludeAudioLanguageSearch('');
      return;
    }
    if (activeProfile.isDefault) {
      const takenNames = new Set(
        immaculateProfiles
          .filter((profile) => profile.id !== activeProfile.id)
          .map((profile) => profile.name.trim().toLowerCase()),
      );
      const targetDefaultName =
        ['Default', 'Default profile'].find(
          (candidate) =>
            candidate.toLowerCase() === activeProfile.name.trim().toLowerCase() ||
            !takenNames.has(candidate.toLowerCase()),
        ) ?? activeProfile.name;
      setProfileDraft(createNetZeroDefaultProfileDraft(targetDefaultName));
      setGenreSearch('');
      setAudioLanguageSearch('');
      setExcludeGenreSearch('');
      setExcludeAudioLanguageSearch('');
      return;
    }
    setProfileDraft(toProfileDraft(activeProfile));
    setGenreSearch('');
    setAudioLanguageSearch('');
    setExcludeGenreSearch('');
    setExcludeAudioLanguageSearch('');
  }, [activeProfile, activeProfileScopePlexUserId, immaculateProfiles]);

  const closeProfileEditor = useCallback(() => {
    if (activeProfile) {
      setProfileDraft(toProfileDraft(activeProfile, activeProfileScopeOverride));
    }
    setGenreSearch('');
    setAudioLanguageSearch('');
    setExcludeGenreSearch('');
    setExcludeAudioLanguageSearch('');
    setIsProfileEditorOpen(false);
  }, [activeProfile, activeProfileScopeOverride]);

  useEffect(() => {
    if (!isProfileEditorOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element) {
        const withinRadixPopup = target.closest(
          '[data-radix-popper-content-wrapper], [data-radix-select-content]',
        );
        if (withinRadixPopup) return;
      }
      const editor = profileEditorCardRef.current;
      if (!editor) return;
      if (editor.contains(target)) return;
      closeProfileEditor();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [closeProfileEditor, isProfileEditorOpen]);

  const addIncludedGenreTag = useCallback((genre: string) => {
    setProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.includeGenresText);
      const has = existing.some(
        (item) => item.toLowerCase() === genre.trim().toLowerCase(),
      );
      if (has) return current;
      return {
        ...current,
        includeGenresText: [...existing, genre.trim()].join(', '),
      };
    });
    setGenreSearch('');
  }, []);

  const removeIncludedGenreTag = useCallback((genre: string) => {
    setProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.includeGenresText);
      const next = existing.filter((item) => item.toLowerCase() !== genre.trim().toLowerCase());
      return {
        ...current,
        includeGenresText: next.join(', '),
      };
    });
  }, []);

  const handleIncludedGenreSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = trimmedGenreSearch;
        if (!query) return;
        const exactMatch = rankedGenreOptions.find(
          (genre) => genre.toLowerCase() === query.toLowerCase(),
        );
        const firstSearchResult = filteredGenreOptions[0];
        addIncludedGenreTag(exactMatch ?? firstSearchResult ?? query);
        return;
      }
      if (event.key === 'Backspace' && !trimmedGenreSearch && selectedGenres.length) {
        event.preventDefault();
        removeIncludedGenreTag(selectedGenres[selectedGenres.length - 1]);
      }
    },
    [
      addIncludedGenreTag,
      filteredGenreOptions,
      rankedGenreOptions,
      removeIncludedGenreTag,
      selectedGenres,
      trimmedGenreSearch,
    ],
  );

  const addSuggestedIncludedGenre = useCallback((genre: string) => {
    addIncludedGenreTag(genre);
  }, [addIncludedGenreTag]);

  const addNewProfileIncludedGenreTag = useCallback((genre: string) => {
    setNewProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.includeGenresText);
      const has = existing.some(
        (item) => item.toLowerCase() === genre.trim().toLowerCase(),
      );
      if (has) return current;
      return {
        ...current,
        includeGenresText: [...existing, genre.trim()].join(', '),
      };
    });
    setNewProfileGenreSearch('');
  }, []);

  const removeNewProfileIncludedGenreTag = useCallback((genre: string) => {
    setNewProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.includeGenresText);
      const next = existing.filter((item) => item.toLowerCase() !== genre.trim().toLowerCase());
      return {
        ...current,
        includeGenresText: next.join(', '),
      };
    });
  }, []);

  const handleNewProfileIncludedGenreSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = trimmedNewProfileGenreSearch;
        if (!query) return;
        const exactMatch = rankedGenreOptions.find(
          (genre) => genre.toLowerCase() === query.toLowerCase(),
        );
        const firstSearchResult = newProfileFilteredGenreOptions[0];
        addNewProfileIncludedGenreTag(exactMatch ?? firstSearchResult ?? query);
        return;
      }
      if (
        event.key === 'Backspace' &&
        !trimmedNewProfileGenreSearch &&
        newProfileSelectedGenres.length
      ) {
        event.preventDefault();
        removeNewProfileIncludedGenreTag(
          newProfileSelectedGenres[newProfileSelectedGenres.length - 1],
        );
      }
    },
    [
      addNewProfileIncludedGenreTag,
      newProfileFilteredGenreOptions,
      newProfileSelectedGenres,
      rankedGenreOptions,
      removeNewProfileIncludedGenreTag,
      trimmedNewProfileGenreSearch,
    ],
  );

  const addExcludedGenreTag = useCallback((genre: string) => {
    setProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.excludeGenresText);
      const has = existing.some(
        (item) => item.toLowerCase() === genre.trim().toLowerCase(),
      );
      if (has) return current;
      return {
        ...current,
        excludeGenresText: [...existing, genre.trim()].join(', '),
      };
    });
    setExcludeGenreSearch('');
  }, []);

  const removeExcludedGenreTag = useCallback((genre: string) => {
    setProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.excludeGenresText);
      const next = existing.filter((item) => item.toLowerCase() !== genre.trim().toLowerCase());
      return {
        ...current,
        excludeGenresText: next.join(', '),
      };
    });
  }, []);

  const handleExcludedGenreSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = trimmedExcludeGenreSearch;
        if (!query) return;
        const exactMatch = rankedGenreOptions.find(
          (genre) => genre.toLowerCase() === query.toLowerCase(),
        );
        const firstSearchResult = filteredExcludedGenreOptions[0];
        addExcludedGenreTag(exactMatch ?? firstSearchResult ?? query);
        return;
      }
      if (
        event.key === 'Backspace' &&
        !trimmedExcludeGenreSearch &&
        selectedExcludedGenres.length
      ) {
        event.preventDefault();
        removeExcludedGenreTag(selectedExcludedGenres[selectedExcludedGenres.length - 1]);
      }
    },
    [
      addExcludedGenreTag,
      filteredExcludedGenreOptions,
      rankedGenreOptions,
      removeExcludedGenreTag,
      selectedExcludedGenres,
      trimmedExcludeGenreSearch,
    ],
  );

  const addSuggestedExcludedGenre = useCallback((genre: string) => {
    addExcludedGenreTag(genre);
  }, [addExcludedGenreTag]);

  const addNewProfileExcludedGenreTag = useCallback((genre: string) => {
    setNewProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.excludeGenresText);
      const has = existing.some(
        (item) => item.toLowerCase() === genre.trim().toLowerCase(),
      );
      if (has) return current;
      return {
        ...current,
        excludeGenresText: [...existing, genre.trim()].join(', '),
      };
    });
    setNewProfileExcludeGenreSearch('');
  }, []);

  const removeNewProfileExcludedGenreTag = useCallback((genre: string) => {
    setNewProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.excludeGenresText);
      const next = existing.filter((item) => item.toLowerCase() !== genre.trim().toLowerCase());
      return {
        ...current,
        excludeGenresText: next.join(', '),
      };
    });
  }, []);

  const handleNewProfileExcludedGenreSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = trimmedNewProfileExcludeGenreSearch;
        if (!query) return;
        const exactMatch = rankedGenreOptions.find(
          (genre) => genre.toLowerCase() === query.toLowerCase(),
        );
        const firstSearchResult = newProfileFilteredExcludedGenreOptions[0];
        addNewProfileExcludedGenreTag(exactMatch ?? firstSearchResult ?? query);
        return;
      }
      if (
        event.key === 'Backspace' &&
        !trimmedNewProfileExcludeGenreSearch &&
        newProfileSelectedExcludedGenres.length
      ) {
        event.preventDefault();
        removeNewProfileExcludedGenreTag(
          newProfileSelectedExcludedGenres[newProfileSelectedExcludedGenres.length - 1],
        );
      }
    },
    [
      addNewProfileExcludedGenreTag,
      newProfileFilteredExcludedGenreOptions,
      newProfileSelectedExcludedGenres,
      rankedGenreOptions,
      removeNewProfileExcludedGenreTag,
      trimmedNewProfileExcludeGenreSearch,
    ],
  );

  const addIncludedAudioLanguageTag = useCallback((language: string) => {
    setProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.includeAudioLanguagesText);
      const has = existing.some(
        (item) => item.toLowerCase() === language.trim().toLowerCase(),
      );
      if (has) return current;
      return {
        ...current,
        includeAudioLanguagesText: [...existing, language.trim()].join(', '),
      };
    });
    setAudioLanguageSearch('');
  }, []);

  const removeIncludedAudioLanguageTag = useCallback((language: string) => {
    setProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.includeAudioLanguagesText);
      const next = existing.filter(
        (item) => item.toLowerCase() !== language.trim().toLowerCase(),
      );
      return {
        ...current,
        includeAudioLanguagesText: next.join(', '),
      };
    });
  }, []);

  const addNewProfileIncludedAudioLanguageTag = useCallback((language: string) => {
    setNewProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.includeAudioLanguagesText);
      const has = existing.some(
        (item) => item.toLowerCase() === language.trim().toLowerCase(),
      );
      if (has) return current;
      return {
        ...current,
        includeAudioLanguagesText: [...existing, language.trim()].join(', '),
      };
    });
    setNewProfileAudioLanguageSearch('');
  }, []);

  const removeNewProfileIncludedAudioLanguageTag = useCallback((language: string) => {
    setNewProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.includeAudioLanguagesText);
      const next = existing.filter(
        (item) => item.toLowerCase() !== language.trim().toLowerCase(),
      );
      return {
        ...current,
        includeAudioLanguagesText: next.join(', '),
      };
    });
  }, []);

  const handleIncludedAudioLanguageSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = trimmedAudioLanguageSearch;
        if (!query) return;
        const exactMatch = rankedAudioLanguageOptions.find(
          (language) => language.toLowerCase() === query.toLowerCase(),
        );
        const firstSearchResult = filteredAudioLanguageOptions[0];
        addIncludedAudioLanguageTag(exactMatch ?? firstSearchResult ?? query);
        return;
      }
      if (
        event.key === 'Backspace' &&
        !trimmedAudioLanguageSearch &&
        selectedAudioLanguages.length
      ) {
        event.preventDefault();
        removeIncludedAudioLanguageTag(selectedAudioLanguages[selectedAudioLanguages.length - 1]);
      }
    },
    [
      addIncludedAudioLanguageTag,
      filteredAudioLanguageOptions,
      rankedAudioLanguageOptions,
      removeIncludedAudioLanguageTag,
      selectedAudioLanguages,
      trimmedAudioLanguageSearch,
    ],
  );

  const handleNewProfileIncludedAudioLanguageSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = trimmedNewProfileAudioLanguageSearch;
        if (!query) return;
        const exactMatch = rankedAudioLanguageOptions.find(
          (language) => language.toLowerCase() === query.toLowerCase(),
        );
        const firstSearchResult = newProfileFilteredAudioLanguageOptions[0];
        addNewProfileIncludedAudioLanguageTag(exactMatch ?? firstSearchResult ?? query);
        return;
      }
      if (
        event.key === 'Backspace' &&
        !trimmedNewProfileAudioLanguageSearch &&
        newProfileSelectedAudioLanguages.length
      ) {
        event.preventDefault();
        removeNewProfileIncludedAudioLanguageTag(
          newProfileSelectedAudioLanguages[newProfileSelectedAudioLanguages.length - 1],
        );
      }
    },
    [
      addNewProfileIncludedAudioLanguageTag,
      newProfileFilteredAudioLanguageOptions,
      newProfileSelectedAudioLanguages,
      rankedAudioLanguageOptions,
      removeNewProfileIncludedAudioLanguageTag,
      trimmedNewProfileAudioLanguageSearch,
    ],
  );

  const addExcludedAudioLanguageTag = useCallback((language: string) => {
    setProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.excludeAudioLanguagesText);
      const has = existing.some(
        (item) => item.toLowerCase() === language.trim().toLowerCase(),
      );
      if (has) return current;
      return {
        ...current,
        excludeAudioLanguagesText: [...existing, language.trim()].join(', '),
      };
    });
    setExcludeAudioLanguageSearch('');
  }, []);

  const removeExcludedAudioLanguageTag = useCallback((language: string) => {
    setProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.excludeAudioLanguagesText);
      const next = existing.filter(
        (item) => item.toLowerCase() !== language.trim().toLowerCase(),
      );
      return {
        ...current,
        excludeAudioLanguagesText: next.join(', '),
      };
    });
  }, []);

  const handleExcludedAudioLanguageSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = trimmedExcludeAudioLanguageSearch;
        if (!query) return;
        const exactMatch = rankedAudioLanguageOptions.find(
          (language) => language.toLowerCase() === query.toLowerCase(),
        );
        const firstSearchResult = filteredExcludedAudioLanguageOptions[0];
        addExcludedAudioLanguageTag(exactMatch ?? firstSearchResult ?? query);
        return;
      }
      if (
        event.key === 'Backspace' &&
        !trimmedExcludeAudioLanguageSearch &&
        selectedExcludedAudioLanguages.length
      ) {
        event.preventDefault();
        removeExcludedAudioLanguageTag(
          selectedExcludedAudioLanguages[selectedExcludedAudioLanguages.length - 1],
        );
      }
    },
    [
      addExcludedAudioLanguageTag,
      filteredExcludedAudioLanguageOptions,
      rankedAudioLanguageOptions,
      removeExcludedAudioLanguageTag,
      selectedExcludedAudioLanguages,
      trimmedExcludeAudioLanguageSearch,
    ],
  );

  const addSuggestedExcludedAudioLanguage = useCallback((language: string) => {
    addExcludedAudioLanguageTag(language);
  }, [addExcludedAudioLanguageTag]);

  const addNewProfileExcludedAudioLanguageTag = useCallback((language: string) => {
    setNewProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.excludeAudioLanguagesText);
      const has = existing.some(
        (item) => item.toLowerCase() === language.trim().toLowerCase(),
      );
      if (has) return current;
      return {
        ...current,
        excludeAudioLanguagesText: [...existing, language.trim()].join(', '),
      };
    });
    setNewProfileExcludeAudioLanguageSearch('');
  }, []);

  const removeNewProfileExcludedAudioLanguageTag = useCallback((language: string) => {
    setNewProfileDraft((current) => {
      if (!current) return current;
      const existing = normalizeCsvStringList(current.excludeAudioLanguagesText);
      const next = existing.filter(
        (item) => item.toLowerCase() !== language.trim().toLowerCase(),
      );
      return {
        ...current,
        excludeAudioLanguagesText: next.join(', '),
      };
    });
  }, []);

  const handleNewProfileExcludedAudioLanguageSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = trimmedNewProfileExcludeAudioLanguageSearch;
        if (!query) return;
        const exactMatch = rankedAudioLanguageOptions.find(
          (language) => language.toLowerCase() === query.toLowerCase(),
        );
        const firstSearchResult = newProfileFilteredExcludedAudioLanguageOptions[0];
        addNewProfileExcludedAudioLanguageTag(exactMatch ?? firstSearchResult ?? query);
        return;
      }
      if (
        event.key === 'Backspace' &&
        !trimmedNewProfileExcludeAudioLanguageSearch &&
        newProfileSelectedExcludedAudioLanguages.length
      ) {
        event.preventDefault();
        removeNewProfileExcludedAudioLanguageTag(
          newProfileSelectedExcludedAudioLanguages[
            newProfileSelectedExcludedAudioLanguages.length - 1
          ],
        );
      }
    },
    [
      addNewProfileExcludedAudioLanguageTag,
      newProfileFilteredExcludedAudioLanguageOptions,
      newProfileSelectedExcludedAudioLanguages,
      rankedAudioLanguageOptions,
      removeNewProfileExcludedAudioLanguageTag,
      trimmedNewProfileExcludeAudioLanguageSearch,
    ],
  );

  const handleCreateProfile = useCallback(() => {
    if (!newProfileDraft) return;
    const name = newProfileDraft.name.trim();
    if (!name) {
      toast.error('Enter a profile name first.');
      return;
    }
    createImmaculateProfileMutation.mutate({
      draft: newProfileDraft,
      scopePlexUserIds: newProfileScopePlexUserIds,
    });
  }, [createImmaculateProfileMutation, newProfileDraft, newProfileScopePlexUserIds]);

  const handleSaveActiveProfile = useCallback(() => {
    if (!activeProfile || !profileDraft) return;
    if (!activeProfileScopePlexUserId && !profileDraft.name.trim()) {
      toast.error('Profile name cannot be empty.');
      return;
    }
    saveImmaculateProfileMutation.mutate({
      id: activeProfile.id,
      draft: profileDraft,
      scopePlexUserId: activeProfileScopePlexUserId,
    });
  }, [
    activeProfile,
    activeProfileScopePlexUserId,
    profileDraft,
    saveImmaculateProfileMutation,
  ]);

  const selectActiveProfileScopeUser = useCallback(
    (plexUserId: string | null) => {
      if (!activeProfile) return;
      const normalizedPlexUserId = (plexUserId ?? '').trim() || null;
      const scopedOverride = findProfileUserOverride(activeProfile, normalizedPlexUserId);
      setActiveProfileScopePlexUserId(normalizedPlexUserId);
      setProfileDraft(toProfileDraft(activeProfile, scopedOverride));
      setGenreSearch('');
      setAudioLanguageSearch('');
      setExcludeGenreSearch('');
      setExcludeAudioLanguageSearch('');
    },
    [activeProfile],
  );

  const addActiveProfileScopeUser = useCallback(
    (plexUserId: string) => {
      const trimmedPlexUserId = plexUserId.trim();
      if (!activeProfile || !trimmedPlexUserId) return;
      if (activeProfileOverrideUserIds.has(trimmedPlexUserId)) return;
      updateProfileScopeMutation.mutate({
        profileId: activeProfile.id,
        plexUserId: trimmedPlexUserId,
        action: 'add',
      });
      setProfileScopeSearch('');
    },
    [activeProfile, activeProfileOverrideUserIds, updateProfileScopeMutation],
  );

  const removeActiveProfileScopeUser = useCallback(
    (plexUserId: string) => {
      const trimmedPlexUserId = plexUserId.trim();
      if (!activeProfile || !trimmedPlexUserId) return;
      if (!activeProfileOverrideUserIds.has(trimmedPlexUserId)) return;
      updateProfileScopeMutation.mutate({
        profileId: activeProfile.id,
        plexUserId: trimmedPlexUserId,
        action: 'remove',
      });
      setProfileScopeSearch('');
    },
    [activeProfile, activeProfileOverrideUserIds, updateProfileScopeMutation],
  );

  const addNewProfileScopeUser = useCallback((plexUserId: string) => {
    const trimmedPlexUserId = plexUserId.trim();
    if (!trimmedPlexUserId) return;
    setNewProfileScopePlexUserIds((current) => {
      if (current.includes(trimmedPlexUserId)) return current;
      return [...current, trimmedPlexUserId];
    });
    setNewProfileScopeSearch('');
  }, []);

  const removeNewProfileScopeUser = useCallback((plexUserId: string) => {
    const trimmedPlexUserId = plexUserId.trim();
    if (!trimmedPlexUserId) return;
    setNewProfileScopePlexUserIds((current) =>
      current.filter((item) => item !== trimmedPlexUserId),
    );
    setNewProfileScopeSearch('');
  }, []);

  const profileDeleteDialogDescription = useMemo(() => {
    if (!activeProfileDeleteImpact) {
      return 'Deleting this profile removes profile-specific dataset entries.';
    }
    if (activeProfileDeleteImpact.uniqueCollectionNames.length > 0) {
      const count = activeProfileDeleteImpact.uniqueCollectionNames.length;
      return (
        <>
          This action will erase this profile&apos;s filters and delete{' '}
          {count === 1 ? 'the Plex collection listed below' : 'the Plex collections listed below'}.
          This cannot be undone.
        </>
      );
    }
    if (activeProfileDeleteImpact.sharedCollectionNames.length > 0) {
      return 'Shared Plex collections are used by another enabled profile, so they will be kept. Are you sure you want to delete this profile?';
    }
    return 'Deleting this profile removes profile-specific filters and dataset entries.';
  }, [activeProfileDeleteImpact]);
  const profileDeleteDialogDetails = useMemo(() => {
    if (!activeProfileDeleteImpact) return null;
    return (
      <div className="space-y-3">
        {activeProfileDeleteImpact.uniqueCollectionNames.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-200/80">
              Plex collections that will be deleted
            </div>
            <div className="flex flex-wrap gap-2">
              {activeProfileDeleteImpact.uniqueCollectionNames.map((name) => (
                <span
                  key={`delete-unique-${name}`}
                  className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-500/15 px-2.5 py-1 text-xs font-semibold text-rose-100"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {activeProfileDeleteImpact.sharedCollectionNames.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-white/50">
              Shared collections that will be kept
            </div>
            <div className="flex flex-wrap gap-2">
              {activeProfileDeleteImpact.sharedCollectionNames.map((name) => (
                <span
                  key={`delete-shared-${name}`}
                  className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/80"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {activeProfileDeleteImpact.defaultWillAutoEnable ? (
          <div className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100/90">
            Deleting this profile will re-enable the default profile so at least one profile remains
            enabled.
          </div>
        ) : null}
      </div>
    );
  }, [activeProfileDeleteImpact]);
  const closeProfileDeleteDialog = useCallback(() => {
    setProfileDeleteDialogOpen(false);
  }, []);
  const confirmProfileDeleteDialog = useCallback(() => {
    if (!activeProfile || activeProfile.isDefault) return;
    deleteImmaculateProfileMutation.mutate(activeProfile);
  }, [activeProfile, deleteImmaculateProfileMutation]);
  const handleDeleteActiveProfile = useCallback(() => {
    if (!activeProfile) return;
    if (activeProfile.isDefault) {
      toast.error('Default profile cannot be deleted.');
      return;
    }
    setProfileDeleteDialogOpen(true);
  }, [activeProfile]);

  const secretsPresent = settingsQuery.data?.secretsPresent ?? {};
  const seerrEnabledFlag = readBool(
    settingsQuery.data?.settings,
    'seerr.enabled',
  );
  const seerrBaseUrl = readString(
    settingsQuery.data?.settings,
    'seerr.baseUrl',
  );
  const seerrHasSecret = Boolean(secretsPresent.seerr);
  // Back-compat: if seerr.enabled isn't set, treat "secret present" as enabled.
  const seerrConfigured =
    (seerrEnabledFlag ?? seerrHasSecret) &&
    Boolean(seerrBaseUrl) &&
    seerrHasSecret;

  const radarrEnabledFlag = readBool(settingsQuery.data?.settings, 'radarr.enabled');
  const radarrBaseUrl = readString(settingsQuery.data?.settings, 'radarr.baseUrl');
  const radarrHasSecret = Boolean(secretsPresent.radarr);
  // Back-compat: if radarr.enabled isn't set, treat "secret present" as enabled.
  const radarrEnabled = (radarrEnabledFlag ?? radarrHasSecret) && Boolean(radarrBaseUrl) && radarrHasSecret;

  const radarrOptionsQuery = useQuery({
    queryKey: ['integrations', 'radarr', 'options'],
    queryFn: getRadarrOptions,
    enabled: radarrEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const configuredRootFolderPath = readString(
    settingsQuery.data?.settings,
    'radarr.defaultRootFolderPath',
  );
  const configuredQualityProfileId =
    readNumber(settingsQuery.data?.settings, 'radarr.defaultQualityProfileId') ?? null;
  const configuredTagId =
    readNumber(settingsQuery.data?.settings, 'radarr.defaultTagId') ?? null;

  const effectiveDefaults = useMemo(() => {
    const opts = radarrOptionsQuery.data;
    const rootFolders = opts?.rootFolders ?? [];
    const qualityProfiles = opts?.qualityProfiles ?? [];
    const tags = opts?.tags ?? [];

    const rootFolderPath =
      (configuredRootFolderPath &&
        rootFolders.some((r) => r.path === configuredRootFolderPath) &&
        configuredRootFolderPath) ||
      (rootFolders[0]?.path ?? '');

    const qualityProfileId = (() => {
      if (
        configuredQualityProfileId &&
        qualityProfiles.some((p) => p.id === configuredQualityProfileId)
      )
        return configuredQualityProfileId;
      if (qualityProfiles.some((p) => p.id === 1)) return 1;
      return qualityProfiles[0]?.id ?? 1;
    })();

    const tagId =
      configuredTagId && tags.some((t) => t.id === configuredTagId)
        ? configuredTagId
        : null;

    return { rootFolderPath, qualityProfileId, tagId };
  }, [
    configuredRootFolderPath,
    configuredQualityProfileId,
    configuredTagId,
    radarrOptionsQuery.data,
  ]);

  const didInitRadarrDefaults = useRef(false);
  const [draftRootFolderPath, setDraftRootFolderPath] = useState('');
  const [draftQualityProfileId, setDraftQualityProfileId] = useState<number>(1);
  const [draftTagId, setDraftTagId] = useState<number | null>(null);

  useEffect(() => {
    if (!radarrEnabled) {
      didInitRadarrDefaults.current = false;
      return;
    }
    if (!radarrOptionsQuery.data) return;
    if (didInitRadarrDefaults.current) return;
    didInitRadarrDefaults.current = true;
    const timeout = window.setTimeout(() => {
      setDraftRootFolderPath(effectiveDefaults.rootFolderPath);
      setDraftQualityProfileId(effectiveDefaults.qualityProfileId);
      setDraftTagId(effectiveDefaults.tagId);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [radarrEnabled, radarrOptionsQuery.data, effectiveDefaults]);

  const saveRadarrDefaultsMutation = useMutation({
    mutationFn: async (patch: {
      defaultRootFolderPath?: string;
      defaultQualityProfileId?: number;
      defaultTagId?: number | null;
    }) =>
      putSettings({
        settings: {
          radarr: patch,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });

  const sonarrEnabledFlag = readBool(settingsQuery.data?.settings, 'sonarr.enabled');
  const sonarrBaseUrl = readString(settingsQuery.data?.settings, 'sonarr.baseUrl');
  const sonarrHasSecret = Boolean(secretsPresent.sonarr);
  // Back-compat: if sonarr.enabled isn't set, treat "secret present" as enabled.
  const sonarrEnabled =
    (sonarrEnabledFlag ?? sonarrHasSecret) &&
    Boolean(sonarrBaseUrl) &&
    sonarrHasSecret;

  const sonarrOptionsQuery = useQuery({
    queryKey: ['integrations', 'sonarr', 'options'],
    queryFn: getSonarrOptions,
    enabled: sonarrEnabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const configuredSonarrRootFolderPath = readString(
    settingsQuery.data?.settings,
    'sonarr.defaultRootFolderPath',
  );
  const configuredSonarrQualityProfileId =
    readNumber(settingsQuery.data?.settings, 'sonarr.defaultQualityProfileId') ??
    null;
  const configuredSonarrTagId =
    readNumber(settingsQuery.data?.settings, 'sonarr.defaultTagId') ?? null;

  const sonarrEffectiveDefaults = useMemo(() => {
    const opts = sonarrOptionsQuery.data;
    const rootFolders = opts?.rootFolders ?? [];
    const qualityProfiles = opts?.qualityProfiles ?? [];
    const tags = opts?.tags ?? [];

    const rootFolderPath =
      (configuredSonarrRootFolderPath &&
        rootFolders.some((r) => r.path === configuredSonarrRootFolderPath) &&
        configuredSonarrRootFolderPath) ||
      (rootFolders[0]?.path ?? '');

    const qualityProfileId = (() => {
      if (
        configuredSonarrQualityProfileId &&
        qualityProfiles.some((p) => p.id === configuredSonarrQualityProfileId)
      )
        return configuredSonarrQualityProfileId;
      if (qualityProfiles.some((p) => p.id === 1)) return 1;
      return qualityProfiles[0]?.id ?? 1;
    })();

    const tagId =
      configuredSonarrTagId && tags.some((t) => t.id === configuredSonarrTagId)
        ? configuredSonarrTagId
        : null;

    return { rootFolderPath, qualityProfileId, tagId };
  }, [
    configuredSonarrRootFolderPath,
    configuredSonarrQualityProfileId,
    configuredSonarrTagId,
    sonarrOptionsQuery.data,
  ]);

  const didInitSonarrDefaults = useRef(false);
  const [sonarrDraftRootFolderPath, setSonarrDraftRootFolderPath] = useState('');
  const [sonarrDraftQualityProfileId, setSonarrDraftQualityProfileId] = useState<number>(1);
  const [sonarrDraftTagId, setSonarrDraftTagId] = useState<number | null>(null);

  useEffect(() => {
    if (!sonarrEnabled) {
      didInitSonarrDefaults.current = false;
      return;
    }
    if (!sonarrOptionsQuery.data) return;
    if (didInitSonarrDefaults.current) return;
    didInitSonarrDefaults.current = true;
    const timeout = window.setTimeout(() => {
      setSonarrDraftRootFolderPath(sonarrEffectiveDefaults.rootFolderPath);
      setSonarrDraftQualityProfileId(sonarrEffectiveDefaults.qualityProfileId);
      setSonarrDraftTagId(sonarrEffectiveDefaults.tagId);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [sonarrEnabled, sonarrOptionsQuery.data, sonarrEffectiveDefaults]);

  const saveSonarrDefaultsMutation = useMutation({
    mutationFn: async (patch: {
      defaultRootFolderPath?: string;
      defaultQualityProfileId?: number;
      defaultTagId?: number | null;
    }) =>
      putSettings({
        settings: {
          sonarr: patch,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });
  const saveRadarrInstanceDefaultsMutation = useMutation({
    mutationFn: async (params: {
      instanceId: string;
      patch: {
        rootFolderPath?: string | null;
        qualityProfileId?: number | null;
        tagId?: number | null;
      };
    }) => await updateArrInstance(params.instanceId, params.patch),
    onMutate: (variables) => {
      const queryKey = ['arr-instances'] as const;
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (current: unknown) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
        const raw = current as { ok?: unknown; instances?: unknown };
        if (!Array.isArray(raw.instances)) return current;
        return {
          ...raw,
          instances: raw.instances.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
            const instance = item as Record<string, unknown>;
            if (String(instance.id ?? '') !== variables.instanceId) return item;
            return {
              ...instance,
              ...(Object.prototype.hasOwnProperty.call(variables.patch, 'rootFolderPath')
                ? { rootFolderPath: variables.patch.rootFolderPath ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(variables.patch, 'qualityProfileId')
                ? { qualityProfileId: variables.patch.qualityProfileId ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(variables.patch, 'tagId')
                ? { tagId: variables.patch.tagId ?? null }
                : {}),
            };
          }),
        };
      });
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['arr-instances'], (current: unknown) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
        const raw = current as { ok?: unknown; instances?: unknown };
        if (!Array.isArray(raw.instances)) return current;
        return {
          ...raw,
          instances: raw.instances.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
            const instance = item as Record<string, unknown>;
            return String(instance.id ?? '') === data.instance.id ? data.instance : item;
          }),
        };
      });
    },
    onError: (error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['arr-instances'], context.previous);
      }
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(
            error.body,
            error.message || 'Failed to save Radarr server defaults',
          ),
        );
        return;
      }
      toast.error(
        error instanceof Error ? error.message : 'Failed to save Radarr server defaults',
      );
    },
  });
  const saveSonarrInstanceDefaultsMutation = useMutation({
    mutationFn: async (params: {
      instanceId: string;
      patch: {
        rootFolderPath?: string | null;
        qualityProfileId?: number | null;
        tagId?: number | null;
      };
    }) => await updateArrInstance(params.instanceId, params.patch),
    onMutate: (variables) => {
      const queryKey = ['arr-instances'] as const;
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (current: unknown) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
        const raw = current as { ok?: unknown; instances?: unknown };
        if (!Array.isArray(raw.instances)) return current;
        return {
          ...raw,
          instances: raw.instances.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
            const instance = item as Record<string, unknown>;
            if (String(instance.id ?? '') !== variables.instanceId) return item;
            return {
              ...instance,
              ...(Object.prototype.hasOwnProperty.call(variables.patch, 'rootFolderPath')
                ? { rootFolderPath: variables.patch.rootFolderPath ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(variables.patch, 'qualityProfileId')
                ? { qualityProfileId: variables.patch.qualityProfileId ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(variables.patch, 'tagId')
                ? { tagId: variables.patch.tagId ?? null }
                : {}),
            };
          }),
        };
      });
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['arr-instances'], (current: unknown) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return current;
        const raw = current as { ok?: unknown; instances?: unknown };
        if (!Array.isArray(raw.instances)) return current;
        return {
          ...raw,
          instances: raw.instances.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
            const instance = item as Record<string, unknown>;
            return String(instance.id ?? '') === data.instance.id ? data.instance : item;
          }),
        };
      });
    },
    onError: (error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['arr-instances'], context.previous);
      }
      if (error instanceof ApiError) {
        toast.error(
          readErrorMessage(
            error.body,
            error.message || 'Failed to save Sonarr server defaults',
          ),
        );
        return;
      }
      toast.error(
        error instanceof Error ? error.message : 'Failed to save Sonarr server defaults',
      );
    },
  });

  const didInitRecommendations = useRef(false);
  const savedRecommendationCount =
    readNumber(settingsQuery.data?.settings, 'recommendations.count') ?? 10;
  const savedUpcomingPercentRaw =
    readNumber(settingsQuery.data?.settings, 'recommendations.upcomingPercent') ?? 25;
  const savedUpcomingPercent = Math.max(0, Math.min(75, Math.trunc(savedUpcomingPercentRaw)));

  const [draftRecommendationCount, setDraftRecommendationCount] = useState<number>(10);
  const [draftUpcomingPercent, setDraftUpcomingPercent] = useState<number>(25);

  useEffect(() => {
    if (!settingsQuery.data?.settings) return;
    if (didInitRecommendations.current) return;
    didInitRecommendations.current = true;
    const timeout = window.setTimeout(() => {
      setDraftRecommendationCount(
        Math.max(5, Math.min(100, Math.trunc(savedRecommendationCount))),
      );
      setDraftUpcomingPercent(savedUpcomingPercent);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [settingsQuery.data?.settings, savedRecommendationCount, savedUpcomingPercent]);

  const saveRecommendationsMutation = useMutation({
    mutationFn: async (patch: { count?: number; upcomingPercent?: number }) =>
      putSettings({
        settings: {
          recommendations: patch,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });

  const effectiveRecommendationCount = Math.max(
    5,
    Math.min(
      100,
      Math.trunc(Number.isFinite(draftRecommendationCount) ? draftRecommendationCount : 10),
    ),
  );
  const effectiveUpcomingPercent = Math.max(
    0,
    Math.min(75, Math.trunc(draftUpcomingPercent || 0)),
  );
  const effectiveReleasedPercent = 100 - effectiveUpcomingPercent;
  const upcomingTargetRaw = Math.round(
    (effectiveRecommendationCount * effectiveUpcomingPercent) / 100,
  );
  const minReleasedTarget = Math.ceil((effectiveRecommendationCount * 25) / 100);
  const maxUpcomingTarget = Math.max(0, effectiveRecommendationCount - minReleasedTarget);
  const upcomingTarget = Math.max(0, Math.min(upcomingTargetRaw, maxUpcomingTarget));
  const releasedTarget = Math.max(0, effectiveRecommendationCount - upcomingTarget);

  const serverSelectedPlexLibraryKeys = useMemo(
    () => plexLibrariesQuery.data?.selectedSectionKeys ?? [],
    [plexLibrariesQuery.data?.selectedSectionKeys],
  );
  const plexLibrarySelectionDirty = useMemo(() => {
    if (!plexLibrariesQuery.data) return false;
    if (draftSelectedPlexLibraryKeys.length !== serverSelectedPlexLibraryKeys.length) {
      return true;
    }
    const serverSet = new Set(serverSelectedPlexLibraryKeys);
    return draftSelectedPlexLibraryKeys.some((key) => !serverSet.has(key));
  }, [
    draftSelectedPlexLibraryKeys,
    plexLibrariesQuery.data,
    serverSelectedPlexLibraryKeys,
  ]);
  const deselectedPlexLibraries = useMemo(() => {
    if (!plexLibrariesQuery.data) return [];
    const serverSelectedSet = new Set(serverSelectedPlexLibraryKeys);
    const draftSelectedSet = new Set(draftSelectedPlexLibraryKeys);
    return (plexLibrariesQuery.data.libraries ?? []).filter(
      (lib) => serverSelectedSet.has(lib.key) && !draftSelectedSet.has(lib.key),
    );
  }, [
    draftSelectedPlexLibraryKeys,
    plexLibrariesQuery.data,
    serverSelectedPlexLibraryKeys,
  ]);

  const togglePlexLibrarySelectionDraft = useCallback((
    librarySectionKey: string,
    checked: boolean,
  ) => {
    setDraftSelectedPlexLibraryKeys((prev) => {
      const has = prev.includes(librarySectionKey);
      if (checked) {
        if (has) return prev;
        return [...prev, librarySectionKey];
      }
      if (!has) return prev;
      if (prev.length <= 1) {
        setPlexLibraryMinDialogOpen(true);
        return prev;
      }
      return prev.filter((key) => key !== librarySectionKey);
    });
  }, []);

  const savePlexLibrarySelectionMutation = useMutation({
    mutationFn: async (params: {
      selectedSectionKeys: string[];
      cleanupDeselectedLibraries?: boolean;
    }) =>
      await savePlexLibrarySelection({
        selectedSectionKeys: params.selectedSectionKeys,
        cleanupDeselectedLibraries: params.cleanupDeselectedLibraries,
      }),
    onSuccess: async (data, variables) => {
      queryClient.setQueryData(['integrations', 'plex', 'libraries'], data);
      setDraftSelectedPlexLibraryKeys(data.selectedSectionKeys);
      setPlexLibraryDeselectDialogOpen(false);
      await queryClient.invalidateQueries({
        queryKey: ['immaculateTasteCollections'],
      });
      await queryClient.invalidateQueries({
        queryKey: ['immaculateTaste', 'collections'],
      });

      if (variables.cleanupDeselectedLibraries && data.cleanup) {
        const totalDatasetDeleted = data.cleanup.db?.totalDeleted ?? 0;
        const plexCollectionsDeleted = data.cleanup.plex?.collectionsDeleted ?? 0;
        const cleanupErrors = data.cleanup.plex?.errors ?? 0;
        if (data.cleanup.error || cleanupErrors > 0) {
          toast.error(
            `Plex library selection updated, but cleanup had issues. Removed ${totalDatasetDeleted} dataset entr${totalDatasetDeleted === 1 ? 'y' : 'ies'} and ${plexCollectionsDeleted} Plex collection${plexCollectionsDeleted === 1 ? '' : 's'}.`,
          );
          return;
        }
        toast.success(
          `Plex library selection updated. Removed ${totalDatasetDeleted} dataset entr${totalDatasetDeleted === 1 ? 'y' : 'ies'} and ${plexCollectionsDeleted} Plex collection${plexCollectionsDeleted === 1 ? '' : 's'}.`,
        );
        return;
      }

      toast.success('Plex library selection updated.');
    },
  });

  const serverSelectedPlexUserIds = useMemo(
    () => plexMonitoringUsersQuery.data?.selectedPlexUserIds ?? [],
    [plexMonitoringUsersQuery.data?.selectedPlexUserIds],
  );
  const plexUserSelectionDirty = useMemo(() => {
    if (!plexMonitoringUsersQuery.data) return false;
    if (draftSelectedPlexUserIds.length !== serverSelectedPlexUserIds.length) {
      return true;
    }
    const serverSet = new Set(serverSelectedPlexUserIds);
    return draftSelectedPlexUserIds.some((id) => !serverSet.has(id));
  }, [
    draftSelectedPlexUserIds,
    plexMonitoringUsersQuery.data,
    serverSelectedPlexUserIds,
  ]);
  const deselectedPlexMonitoringUsers = useMemo<PlexMonitoringDeselectedUser[]>(() => {
    if (!plexMonitoringUsersQuery.data) return [];
    const serverSelectedSet = new Set(serverSelectedPlexUserIds);
    const draftSelectedSet = new Set(draftSelectedPlexUserIds);
    return (plexMonitoringUsersQuery.data.users ?? [])
      .filter((user) => serverSelectedSet.has(user.id) && !draftSelectedSet.has(user.id))
      .map((user) => ({
        id: user.id,
        plexAccountTitle: user.plexAccountTitle,
      }));
  }, [
    draftSelectedPlexUserIds,
    plexMonitoringUsersQuery.data,
    serverSelectedPlexUserIds,
  ]);

  const togglePlexUserSelectionDraft = useCallback((plexUserId: string, checked: boolean) => {
    setDraftSelectedPlexUserIds((prev) => {
      const has = prev.includes(plexUserId);
      if (checked) {
        if (has) return prev;
        return [...prev, plexUserId];
      }
      if (!has) return prev;
      return prev.filter((id) => id !== plexUserId);
    });
  }, []);

  const savePlexMonitoringUsersMutation = useMutation({
    mutationFn: async (params: {
      selectedPlexUserIds: string[];
      usersToReset?: PlexMonitoringDeselectedUser[];
    }) => {
      const data = await savePlexMonitoringUsers({
        selectedPlexUserIds: params.selectedPlexUserIds,
      });

      const usersToReset = params.usersToReset ?? [];
      let resetFailures = 0;
      let datasetDeleted = 0;
      let plexCollectionsDeleted = 0;
      for (const user of usersToReset) {
        for (const mediaType of ['movie', 'tv'] as const) {
          try {
            const response = await resetImmaculateTasteUserCollection({
              plexUserId: user.id,
              mediaType,
              includeWatchedCollections: true,
            });
            datasetDeleted += response.dataset.deleted;
            plexCollectionsDeleted += response.plex.deleted;
          } catch {
            resetFailures += 1;
          }
        }
      }

      return {
        data,
        resetRequestedUserCount: usersToReset.length,
        resetFailures,
        datasetDeleted,
        plexCollectionsDeleted,
      };
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(['integrations', 'plex', 'monitoring-users'], result.data);
      setDraftSelectedPlexUserIds(result.data.selectedPlexUserIds);
      setPlexUserDeselectDialogOpen(false);
      setPendingPlexUserDeselectUsers([]);

      if (result.resetRequestedUserCount > 0) {
        await queryClient.invalidateQueries({
          queryKey: ['immaculateTaste', 'collections'],
        });
        await queryClient.invalidateQueries({
          queryKey: ['immaculateTaste', 'users'],
        });

        if (result.resetFailures > 0) {
          toast.error(
            `Plex user monitoring updated, but ${result.resetFailures} collection reset request${result.resetFailures === 1 ? '' : 's'} failed.`,
          );
          return;
        }

        toast.success(
          `Plex user monitoring updated. Removed ${result.datasetDeleted} dataset entr${result.datasetDeleted === 1 ? 'y' : 'ies'} and ${result.plexCollectionsDeleted} Plex collection${result.plexCollectionsDeleted === 1 ? '' : 's'} for ${result.resetRequestedUserCount} user${result.resetRequestedUserCount === 1 ? '' : 's'}.`,
        );
        return;
      }

      toast.success('Plex user monitoring updated.');
    },
  });
  const clearCollectionArtworkFlow = useCallback(() => {
    setSelectedCollectionArtworkUserId(null);
    setSelectedCollectionArtworkTargetKey('');
    setCollectionArtworkUserSearch('');
    setCollectionArtworkFile(null);
    setCollectionArtworkPreviewOpen(false);
    setCollectionArtworkPreviewFailed(false);
    if (collectionArtworkFileInputRef.current) {
      collectionArtworkFileInputRef.current.value = '';
    }
  }, []);
  const selectCollectionArtworkUser = useCallback(
    (plexUserId: string) => {
      if (selectedCollectionArtworkUserId === plexUserId) {
        clearCollectionArtworkFlow();
        return;
      }
      setSelectedCollectionArtworkUserId(plexUserId);
      setSelectedCollectionArtworkTargetKey('');
      setCollectionArtworkFile(null);
      setCollectionArtworkPreviewOpen(false);
      setCollectionArtworkPreviewFailed(false);
      if (collectionArtworkFileInputRef.current) {
        collectionArtworkFileInputRef.current.value = '';
      }
      setCollectionArtworkUserSearch('');
    },
    [clearCollectionArtworkFlow, selectedCollectionArtworkUserId],
  );
  const handleCollectionArtworkTargetChange = useCallback((value: string) => {
    setSelectedCollectionArtworkTargetKey(value);
    setCollectionArtworkFile(null);
    setCollectionArtworkPreviewOpen(false);
    setCollectionArtworkPreviewFailed(false);
    if (collectionArtworkFileInputRef.current) {
      collectionArtworkFileInputRef.current.value = '';
    }
  }, []);
  const handleCollectionArtworkFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.currentTarget.files?.[0] ?? null;
      setCollectionArtworkFile(nextFile);
    },
    [],
  );
  const saveCollectionArtworkOverride = useCallback(() => {
    if (!selectedCollectionArtworkUserId) {
      toast.error('Select a Plex user first.');
      return;
    }
    if (!selectedCollectionArtworkTarget) {
      toast.error('Select a collection target first.');
      return;
    }
    if (!collectionArtworkFile) {
      toast.error('Choose a poster image first.');
      return;
    }
    saveCollectionArtworkOverrideMutation.mutate();
  }, [
    collectionArtworkFile,
    saveCollectionArtworkOverrideMutation,
    selectedCollectionArtworkTarget,
    selectedCollectionArtworkUserId,
  ]);
  const resetCollectionArtworkOverride = useCallback(() => {
    if (!selectedCollectionArtworkTarget?.hasCustomPoster) {
      toast.error('No custom poster is set for this target.');
      return;
    }
    resetCollectionArtworkOverrideMutation.mutate();
  }, [resetCollectionArtworkOverrideMutation, selectedCollectionArtworkTarget]);
  const openCollectionArtworkPreview = useCallback(() => {
    if (!selectedCollectionArtworkTarget?.hasCustomPoster) {
      toast.error('No custom poster is set for this target.');
      return;
    }
    setCollectionArtworkPreviewFailed(false);
    setCollectionArtworkPreviewOpen(true);
  }, [selectedCollectionArtworkTarget]);
  const closeCollectionArtworkPreview = useCallback(() => {
    setCollectionArtworkPreviewOpen(false);
    setCollectionArtworkPreviewFailed(false);
  }, []);

  const renderAdminCollectionList = () => (
    <div className="space-y-3">
      {(immaculateCollectionsQuery.data?.collections ?? []).map((c) => {
        const typeLabel = c.mediaType === 'movie' ? 'Movie' : 'TV';
        const plexLabel =
          c.plex.collectionRatingKey
            ? typeof c.plex.itemCount === 'number'
              ? `${c.plex.itemCount} items`
              : '—'
            : 'Not found';

        return (
          <div
            key={`${c.mediaType}:${c.librarySectionKey}`}
            className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:bg-white/10"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/70">
                  {typeLabel}
                </span>
                <div className="truncate text-sm font-semibold text-white">
                  {c.libraryTitle}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/70">
                  Plex {plexLabel}
                </span>
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/70">
                  {c.dataset.total} tracked
                </span>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-emerald-100">
                  {c.dataset.active} active
                </span>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-amber-100">
                  {c.dataset.pending} pending
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={resetImmaculateMutation.isPending}
              data-media-type={c.mediaType}
              data-library-section-key={c.librarySectionKey}
              data-library-title={c.libraryTitle}
              data-dataset-total={String(c.dataset.total)}
              data-dataset-active={String(c.dataset.active)}
              data-dataset-pending={String(c.dataset.pending)}
              data-plex-collection-name={c.plex.collectionName}
              data-plex-collection-rating-key={c.plex.collectionRatingKey ?? ''}
              data-plex-item-count={
                typeof c.plex.itemCount === 'number' ? String(c.plex.itemCount) : ''
              }
              onClick={openImmaculateResetTarget}
              className="inline-flex items-center gap-2 shrink-0 rounded-xl border border-amber-300/25 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-400/20 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {resetImmaculateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              Reset
            </button>
          </div>
        );
      })}

      {!immaculateCollectionsQuery.isLoading &&
      !immaculateCollectionsQuery.isError &&
      (immaculateCollectionsQuery.data?.collections ?? []).length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
          No Plex libraries found.
        </div>
      ) : null}
    </div>
  );
  const closePlexLibraryDeselectDialog = useCallback(() => {
    if (savePlexLibrarySelectionMutation.isPending) return;
    setPlexLibraryDeselectDialogOpen(false);
  }, [savePlexLibrarySelectionMutation.isPending]);
  const confirmPlexLibraryKeepCollectionsDialog = useCallback(() => {
    savePlexLibrarySelectionMutation.mutate({
      selectedSectionKeys: draftSelectedPlexLibraryKeys,
      cleanupDeselectedLibraries: false,
    });
  }, [draftSelectedPlexLibraryKeys, savePlexLibrarySelectionMutation]);
  const confirmPlexLibraryDeleteCollectionsDialog = useCallback(() => {
    savePlexLibrarySelectionMutation.mutate({
      selectedSectionKeys: draftSelectedPlexLibraryKeys,
      cleanupDeselectedLibraries: true,
    });
  }, [draftSelectedPlexLibraryKeys, savePlexLibrarySelectionMutation]);
  const closePlexLibraryMinDialog = useCallback(() => {
    setPlexLibraryMinDialogOpen(false);
  }, []);
  const stopClickPropagation = useCallback((event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  }, []);
  const handleRecommendationCountChange = useCallback((next: number) => {
    const clamped = Number.isFinite(next)
      ? Math.max(5, Math.min(100, Math.trunc(next)))
      : 50;
    setDraftRecommendationCount(clamped);
  }, []);
  const handleRecommendationCountCommit = useCallback(
    (next: number) => {
      const clamped = Number.isFinite(next)
        ? Math.max(5, Math.min(100, Math.trunc(next)))
        : 50;
      saveRecommendationsMutation.mutate({ count: clamped });
    },
    [saveRecommendationsMutation],
  );
  const handleReleasedPercentChange = useCallback((releasedPct: number) => {
    const clampedReleased = Number.isFinite(releasedPct)
      ? Math.max(25, Math.min(100, Math.trunc(releasedPct)))
      : 75;
    const nextUpcoming = Math.max(
      0,
      Math.min(75, Math.trunc(100 - clampedReleased)),
    );
    setDraftUpcomingPercent(nextUpcoming);
  }, []);
  const handleReleasedPercentCommit = useCallback(
    (releasedPct: number) => {
      const clampedReleased = Number.isFinite(releasedPct)
        ? Math.max(25, Math.min(100, Math.trunc(releasedPct)))
        : 75;
      const nextUpcoming = Math.max(
        0,
        Math.min(75, Math.trunc(100 - clampedReleased)),
      );
      saveRecommendationsMutation.mutate({
        upcomingPercent: nextUpcoming,
      });
    },
    [saveRecommendationsMutation],
  );
  const retryPlexLibraries = useCallback(() => {
    void plexLibrariesQuery.refetch();
  }, [plexLibrariesQuery]);
  const handlePlexLibraryCheckboxChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const librarySectionKey = event.currentTarget.dataset.librarySectionKey;
      if (!librarySectionKey) return;
      togglePlexLibrarySelectionDraft(librarySectionKey, event.currentTarget.checked);
    },
    [togglePlexLibrarySelectionDraft],
  );
  const resetPlexLibrarySelectionDraft = useCallback(() => {
    setDraftSelectedPlexLibraryKeys(serverSelectedPlexLibraryKeys);
    setPlexLibraryDeselectDialogOpen(false);
  }, [serverSelectedPlexLibraryKeys]);
  const savePlexLibrarySelectionDraft = useCallback(() => {
    if (deselectedPlexLibraries.length > 0) {
      setPlexLibraryDeselectDialogOpen(true);
      return;
    }
    savePlexLibrarySelectionMutation.mutate({
      selectedSectionKeys: draftSelectedPlexLibraryKeys,
    });
  }, [
    deselectedPlexLibraries.length,
    draftSelectedPlexLibraryKeys,
    savePlexLibrarySelectionMutation,
  ]);
  const handlePlexUserCheckboxChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const plexUserId = event.currentTarget.dataset.plexUserId;
      if (!plexUserId) return;
      togglePlexUserSelectionDraft(plexUserId, event.currentTarget.checked);
    },
    [togglePlexUserSelectionDraft],
  );
  const resetPlexUserSelectionDraft = useCallback(() => {
    setDraftSelectedPlexUserIds(serverSelectedPlexUserIds);
    setPlexUserDeselectDialogOpen(false);
    setPendingPlexUserDeselectUsers([]);
  }, [serverSelectedPlexUserIds]);
  const closePlexUserDeselectDialog = useCallback(() => {
    if (savePlexMonitoringUsersMutation.isPending) return;
    setPlexUserDeselectDialogOpen(false);
    setPendingPlexUserDeselectUsers([]);
  }, [savePlexMonitoringUsersMutation.isPending]);
  const confirmPlexUserKeepCollectionsDialog = useCallback(() => {
    savePlexMonitoringUsersMutation.mutate({
      selectedPlexUserIds: draftSelectedPlexUserIds,
    });
  }, [draftSelectedPlexUserIds, savePlexMonitoringUsersMutation]);
  const confirmPlexUserDeleteCollectionsDialog = useCallback(() => {
    savePlexMonitoringUsersMutation.mutate({
      selectedPlexUserIds: draftSelectedPlexUserIds,
      usersToReset: pendingPlexUserDeselectUsers,
    });
  }, [
    draftSelectedPlexUserIds,
    pendingPlexUserDeselectUsers,
    savePlexMonitoringUsersMutation,
  ]);
  const savePlexUserSelectionDraft = useCallback(() => {
    if (deselectedPlexMonitoringUsers.length > 0) {
      setPendingPlexUserDeselectUsers(deselectedPlexMonitoringUsers);
      setPlexUserDeselectDialogOpen(true);
      return;
    }
    savePlexMonitoringUsersMutation.mutate({
      selectedPlexUserIds: draftSelectedPlexUserIds,
    });
  }, [
    deselectedPlexMonitoringUsers,
    draftSelectedPlexUserIds,
    savePlexMonitoringUsersMutation,
  ]);
  const openSeerrResetDialog = useCallback(() => {
    setSeerrResetOpen(true);
  }, []);
  const openRejectedList = useCallback(() => {
    setRejectedListOpen(true);
  }, []);
  const openRejectedResetDialog = useCallback(() => {
    setRejectedResetOpen(true);
  }, []);
  const openImmaculateResetTarget = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const mediaType = event.currentTarget.dataset.mediaType;
    const librarySectionKey = event.currentTarget.dataset.librarySectionKey;
    const libraryTitle = event.currentTarget.dataset.libraryTitle;
    const datasetTotalRaw = event.currentTarget.dataset.datasetTotal;
    const datasetActiveRaw = event.currentTarget.dataset.datasetActive;
    const datasetPendingRaw = event.currentTarget.dataset.datasetPending;
    const plexCollectionName = event.currentTarget.dataset.plexCollectionName ?? '';
    const plexCollectionRatingKey = event.currentTarget.dataset.plexCollectionRatingKey;
    const plexItemCountRaw = event.currentTarget.dataset.plexItemCount;
    if (!mediaType || !librarySectionKey || !libraryTitle) return;
    if (!datasetTotalRaw || !datasetActiveRaw || !datasetPendingRaw) return;
    const datasetTotal = Number.parseInt(datasetTotalRaw, 10);
    const datasetActive = Number.parseInt(datasetActiveRaw, 10);
    const datasetPending = Number.parseInt(datasetPendingRaw, 10);
    if (!Number.isFinite(datasetTotal)) return;
    if (!Number.isFinite(datasetActive)) return;
    if (!Number.isFinite(datasetPending)) return;
    const parsedItemCount =
      typeof plexItemCountRaw === 'string' && plexItemCountRaw.length > 0
        ? Number.parseInt(plexItemCountRaw, 10)
        : null;
    setImmaculateResetTarget({
      mediaType: mediaType === 'tv' ? 'tv' : 'movie',
      librarySectionKey,
      libraryTitle,
      dataset: {
        total: datasetTotal,
        active: datasetActive,
        pending: datasetPending,
      },
      plex: {
        collectionName: plexCollectionName,
        collectionRatingKey: plexCollectionRatingKey || null,
        itemCount: Number.isFinite(parsedItemCount ?? NaN) ? parsedItemCount : null,
      },
    });
  }, []);
  const toggleActiveImmaculateUser = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const userId = event.currentTarget.dataset.plexUserId;
    if (!userId) return;
    setActiveImmaculateUserId((prev) => (prev === userId ? null : userId));
  }, []);
  const openImmaculateUserResetTarget = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const plexUserId = event.currentTarget.dataset.plexUserId;
      const mediaType = event.currentTarget.dataset.mediaType;
      const totalRaw = event.currentTarget.dataset.total;
      if (!plexUserId || !mediaType || !totalRaw) return;
      const total = Number.parseInt(totalRaw, 10);
      if (!Number.isFinite(total)) return;
      setImmaculateUserResetTarget({
        plexUserId,
        plexUserTitle: event.currentTarget.dataset.plexUserTitle || 'Plex User',
        mediaType: mediaType === 'tv' ? 'tv' : 'movie',
        total,
      });
    },
    [],
  );
  const closeImmaculateReset = useCallback(() => {
    if (resetImmaculateMutation.isPending) return;
    setImmaculateResetTarget(null);
  }, [resetImmaculateMutation.isPending]);
  const clearImmaculateReset = useCallback(() => {
    setImmaculateResetTarget(null);
  }, []);
  const confirmImmaculateReset = useCallback(() => {
    if (resetImmaculateMutation.isPending) return;
    const target = immaculateResetTarget;
    if (!target) return;
    resetImmaculateMutation.mutate(
      {
        mediaType: target.mediaType,
        librarySectionKey: target.librarySectionKey,
      },
      {
        onSuccess: () => setImmaculateResetTarget(null),
      },
    );
  }, [immaculateResetTarget, resetImmaculateMutation]);
  const closeImmaculateUserReset = useCallback(() => {
    if (resetImmaculateUserMutation.isPending) return;
    setImmaculateUserResetTarget(null);
  }, [resetImmaculateUserMutation.isPending]);
  const clearImmaculateUserReset = useCallback(() => {
    setImmaculateUserResetTarget(null);
  }, []);
  const confirmImmaculateUserReset = useCallback(() => {
    if (resetImmaculateUserMutation.isPending) return;
    const target = immaculateUserResetTarget;
    if (!target) return;
    resetImmaculateUserMutation.mutate(
      {
        plexUserId: target.plexUserId,
        mediaType: target.mediaType,
      },
      {
        onSuccess: () => setImmaculateUserResetTarget(null),
      },
    );
  }, [immaculateUserResetTarget, resetImmaculateUserMutation]);
  const closeSeerrReset = useCallback(() => {
    if (resetSeerrMutation.isPending) return;
    setSeerrResetOpen(false);
  }, [resetSeerrMutation.isPending]);
  const clearSeerrReset = useCallback(() => {
    setSeerrResetOpen(false);
  }, []);
  const confirmSeerrReset = useCallback(() => {
    if (resetSeerrMutation.isPending) return;
    resetSeerrMutation.mutate(undefined, {
      onSuccess: () => setSeerrResetOpen(false),
    });
  }, [resetSeerrMutation]);
  const closeRejectedReset = useCallback(() => {
    if (resetRejectedMutation.isPending) return;
    setRejectedResetOpen(false);
  }, [resetRejectedMutation.isPending]);
  const clearRejectedReset = useCallback(() => {
    setRejectedResetOpen(false);
  }, []);
  const confirmRejectedReset = useCallback(() => {
    if (resetRejectedMutation.isPending) return;
    resetRejectedMutation.mutate(undefined, {
      onSuccess: () => setRejectedResetOpen(false),
    });
  }, [resetRejectedMutation]);
  const closeRejectedList = useCallback(() => {
    if (deleteRejectedMutation.isPending) return;
    setRejectedListOpen(false);
  }, [deleteRejectedMutation.isPending]);
  const dismissRejectedList = useCallback(() => {
    setRejectedListOpen(false);
  }, []);
  const selectRejectedMovieTab = useCallback(() => {
    setRejectedMediaTab('movie');
  }, []);
  const selectRejectedTvTab = useCallback(() => {
    setRejectedMediaTab('tv');
  }, []);
  const handleRejectedKindClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const kind = event.currentTarget.dataset.rejectedKind as
      | 'all'
      | 'immaculateTaste'
      | 'recentlyWatched'
      | 'changeOfTaste'
      | undefined;
    if (!kind) return;
    setRejectedKind(kind);
  }, []);
  const removeRejectedItem = useCallback(
    (itemId: string) => {
      deleteRejectedMutation.mutate(itemId, {
        onSuccess: () => toast.success('Removed from rejected list.'),
        onError: () => toast.error('Failed to remove.'),
      });
    },
    [deleteRejectedMutation],
  );
  const handleRemoveRejectedItemClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const itemId = event.currentTarget.dataset.itemId;
      if (!itemId) return;
      removeRejectedItem(itemId);
    },
    [removeRejectedItem],
  );
  const handleRadarrRootFolderChange = useCallback(
    (next: string) => {
      setDraftRootFolderPath(next);
      saveRadarrDefaultsMutation.mutate({
        defaultRootFolderPath: next,
      });
    },
    [saveRadarrDefaultsMutation],
  );
  const handleRadarrQualityProfileChange = useCallback(
    (raw: string) => {
      const next = Number.parseInt(raw, 10);
      if (!Number.isFinite(next)) return;
      setDraftQualityProfileId(next);
      saveRadarrDefaultsMutation.mutate({
        defaultQualityProfileId: next,
      });
    },
    [saveRadarrDefaultsMutation],
  );
  const handleRadarrTagChange = useCallback(
    (raw: string) => {
      const parsed = raw === 'none' ? null : Number.parseInt(raw, 10);
      const next = Number.isFinite(parsed ?? NaN) ? (parsed as number) : null;
      setDraftTagId(next);
      saveRadarrDefaultsMutation.mutate({
        defaultTagId: next,
      });
    },
    [saveRadarrDefaultsMutation],
  );
  const handleRadarrSecondaryRootFolderChange = useCallback(
    (instanceId: string, next: string) => {
      saveRadarrInstanceDefaultsMutation.mutate({
        instanceId,
        patch: { rootFolderPath: next || null },
      });
    },
    [saveRadarrInstanceDefaultsMutation],
  );
  const handleRadarrSecondaryQualityProfileChange = useCallback(
    (instanceId: string, raw: string) => {
      const next = Number.parseInt(raw, 10);
      if (!Number.isFinite(next)) return;
      saveRadarrInstanceDefaultsMutation.mutate({
        instanceId,
        patch: { qualityProfileId: next },
      });
    },
    [saveRadarrInstanceDefaultsMutation],
  );
  const handleRadarrSecondaryTagChange = useCallback(
    (instanceId: string, raw: string) => {
      const parsed = raw === 'none' ? null : Number.parseInt(raw, 10);
      const next = Number.isFinite(parsed ?? NaN) ? (parsed as number) : null;
      saveRadarrInstanceDefaultsMutation.mutate({
        instanceId,
        patch: { tagId: next },
      });
    },
    [saveRadarrInstanceDefaultsMutation],
  );
  const handleSonarrRootFolderChange = useCallback(
    (next: string) => {
      setSonarrDraftRootFolderPath(next);
      saveSonarrDefaultsMutation.mutate({
        defaultRootFolderPath: next,
      });
    },
    [saveSonarrDefaultsMutation],
  );
  const handleSonarrSecondaryRootFolderChange = useCallback(
    (instanceId: string, next: string) => {
      saveSonarrInstanceDefaultsMutation.mutate({
        instanceId,
        patch: { rootFolderPath: next || null },
      });
    },
    [saveSonarrInstanceDefaultsMutation],
  );
  const handleSonarrSecondaryQualityProfileChange = useCallback(
    (instanceId: string, raw: string) => {
      const next = Number.parseInt(raw, 10);
      if (!Number.isFinite(next)) return;
      saveSonarrInstanceDefaultsMutation.mutate({
        instanceId,
        patch: { qualityProfileId: next },
      });
    },
    [saveSonarrInstanceDefaultsMutation],
  );
  const handleSonarrSecondaryTagChange = useCallback(
    (instanceId: string, raw: string) => {
      const parsed = raw === 'none' ? null : Number.parseInt(raw, 10);
      const next = Number.isFinite(parsed ?? NaN) ? (parsed as number) : null;
      saveSonarrInstanceDefaultsMutation.mutate({
        instanceId,
        patch: { tagId: next },
      });
    },
    [saveSonarrInstanceDefaultsMutation],
  );
  const handleSonarrQualityProfileChange = useCallback(
    (raw: string) => {
      const next = Number.parseInt(raw, 10);
      if (!Number.isFinite(next)) return;
      setSonarrDraftQualityProfileId(next);
      saveSonarrDefaultsMutation.mutate({
        defaultQualityProfileId: next,
      });
    },
    [saveSonarrDefaultsMutation],
  );
  const handleSonarrTagChange = useCallback(
    (raw: string) => {
      const parsed = raw === 'none' ? null : Number.parseInt(raw, 10);
      const next = Number.isFinite(parsed ?? NaN) ? (parsed as number) : null;
      setSonarrDraftTagId(next);
      saveSonarrDefaultsMutation.mutate({
        defaultTagId: next,
      });
    },
    [saveSonarrDefaultsMutation],
  );

  return (
    <SettingsPage
      pageTitle="Command Center"
      headerIcon={
        <Settings2
          className="w-8 h-8 md:w-10 md:h-10 text-black"
          strokeWidth={2.5}
        />
      }
      backgroundGradientClass="bg-gradient-to-br from-sky-900/55 via-cyan-900/60 to-slate-900/75"
      subtitle={
        <>
          Tweak, tune, and turbocharge your{' '}
          <span className="text-[#facc15] font-bold">setup</span>.
        </>
      }
      subtitleDetails={<>Remember: With great power comes great uptime.</>}
      extraContent={
        <div className="space-y-6">
          {/* Recommendations */}
          <div id="command-center-recommendations" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-recommendations')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-purple-500/10 focus-within:border-white/15 focus-within:shadow-purple-500/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-purple-500/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-purple-300">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <Film className="w-7 h-7" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                    Recommendations
                  </h2>
                  {renderFeatureFaqButton('command-center-recommendations', 'Recommendations')}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {settingsQuery.isLoading ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}>
                    Checking…
                  </span>
                ) : settingsQuery.isError ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}>
                    Error
                  </span>
                ) : null}

                <SavingPill active={saveRecommendationsMutation.isPending} className="static" />
              </div>
            </div>

            {settingsQuery.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Couldn’t load settings. Please refresh and try again.</span>
              </div>
            ) : (
              <>
                    <p className="mt-3 text-sm text-white/70 leading-relaxed">
                      Set how many to generate, then slide the mix:{' '}
                      <span className="text-white">released</span> vs{' '}
                      <span className="text-white">upcoming</span>.
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label="Recommendations info"
                            className="ml-2 inline-flex align-middle items-center justify-center w-7 h-7 rounded-full border border-white/10 bg-white/5 text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                          >
                            <Info className="w-4 h-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="w-72 bg-[#0F0B15] border-white/10 text-white shadow-2xl"
                        >
                          <div className="space-y-2 text-sm text-white/80">
                            <div>Used by Immaculate Taste + Recently Watched.</div>
                            <div>Released stays ≥ 25%.</div>
                            <div>Count can’t go below 5.</div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </p>

                    <div className="mt-6 space-y-8">
                      {/* Count */}
                      <div className="space-y-3">
                        <div className="flex items-end justify-between gap-4">
                          <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                            Recommendation count
                          </div>
                        </div>

                        <FunCountSlider
                          value={effectiveRecommendationCount}
                          min={0}
                          max={100}
                          disabled={saveRecommendationsMutation.isPending}
                          onValueChange={handleRecommendationCountChange}
                          onValueCommit={handleRecommendationCountCommit}
                          aria-label="Recommendation count"
                        />
                      </div>

                      {/* Split */}
                      <div className="space-y-3">
                        <FunSplitSlider
                          value={effectiveReleasedPercent}
                          min={25}
                          max={100}
                          disabled={saveRecommendationsMutation.isPending}
                          onValueChange={handleReleasedPercentChange}
                          onValueCommit={handleReleasedPercentCommit}
                          aria-label="Distribution split (released percent)"
                        />

                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-emerald-500/10 text-emerald-200 border border-emerald-500/20">
                            Ready to watch: {releasedTarget}
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-purple-500/10 text-purple-200 border border-purple-500/20">
                            On the horizon: {upcomingTarget}
                          </span>
                        </div>

                        {saveRecommendationsMutation.isError ? (
                          <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{(saveRecommendationsMutation.error as Error).message}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
              </>
            )}
            </div>
          </div>

          {/* Plex Library Selection */}
          <div id="command-center-plex-library-selection" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-plex-library-selection')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-sky-400/10 focus-within:border-white/15 focus-within:shadow-sky-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-sky-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-sky-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <Tv className="w-7 h-7" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                    Plex Library Selection
                  </h2>
                  {renderFeatureFaqButton(
                    'command-center-plex-library-selection',
                    'Plex Library Selection',
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {plexLibrariesQuery.isLoading ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}>
                    Checking…
                  </span>
                ) : plexLibrariesQuery.isError ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}>
                    Error
                  </span>
                ) : null}
                <SavingPill
                  active={savePlexLibrarySelectionMutation.isPending}
                  className="static"
                />
              </div>
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Choose which movie/TV Plex libraries Immaculaterr can use. Excluded
              libraries are ignored for auto and manual collection/refresher jobs.
            </p>

            {plexLibrariesQuery.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{(plexLibrariesQuery.error as Error).message}</span>
              </div>
            ) : null}

            {!plexLibrariesQuery.isLoading &&
            !plexLibrariesQuery.isError &&
            !plexLibrariesQuery.data?.libraries.length ? (
              <div className="mt-4 space-y-3">
                <div className="text-sm text-white/70">
                  No eligible Plex movie/TV libraries found. Add at least one in Plex,
                  then retry.
                </div>
                <button
                  type="button"
                  onClick={retryPlexLibraries}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors active:scale-95"
                >
                  <ExternalLink className="w-4 h-4" />
                  Retry
                </button>
              </div>
            ) : null}

            {!plexLibrariesQuery.isLoading &&
            !plexLibrariesQuery.isError &&
            (plexLibrariesQuery.data?.libraries.length ?? 0) > 0 ? (
              <div className="mt-5 space-y-4">
                <div className="text-xs text-white/55">
                  Selected {draftSelectedPlexLibraryKeys.length} of{' '}
                  {plexLibrariesQuery.data?.libraries.length ?? 0}. Minimum 1
                  required.
                </div>

                <div className="space-y-2">
                  {(plexLibrariesQuery.data?.libraries ?? []).map((lib) => (
                    <label
                      key={lib.key}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/85"
                    >
                      <input
                        type="checkbox"
                        checked={draftSelectedPlexLibraryKeys.includes(lib.key)}
                        data-library-section-key={lib.key}
                        onChange={handlePlexLibraryCheckboxChange}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-[#facc15] focus:ring-[#facc15] focus:ring-offset-0"
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {lib.title}
                      </span>
                      <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/60">
                        {lib.type === 'movie' ? 'Movie' : 'TV'}
                      </span>
                    </label>
                  ))}
                </div>

                {savePlexLibrarySelectionMutation.isError ? (
                  <div className="flex items-start gap-2 text-sm text-red-200/90">
                    <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      {(savePlexLibrarySelectionMutation.error as Error).message}
                    </span>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={resetPlexLibrarySelectionDraft}
                    disabled={
                      savePlexLibrarySelectionMutation.isPending ||
                      !plexLibrarySelectionDirty
                    }
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={savePlexLibrarySelectionDraft}
                    disabled={
                      savePlexLibrarySelectionMutation.isPending ||
                      !plexLibrarySelectionDirty ||
                      draftSelectedPlexLibraryKeys.length < 1
                    }
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#facc15] px-4 py-2 text-sm font-bold text-black shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                  >
                    {savePlexLibrarySelectionMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save selection'
                    )}
                  </button>
                </div>
              </div>
            ) : null}
            </div>
          </div>

          {/* Plex User Monitoring */}
          <div id="command-center-plex-user-monitoring" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-plex-user-monitoring')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-cyan-400/10 focus-within:border-white/15 focus-within:shadow-cyan-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-cyan-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-cyan-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <Users className="w-7 h-7" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                    Plex User Monitoring
                  </h2>
                  {renderFeatureFaqButton(
                    'command-center-plex-user-monitoring',
                    'Plex User Monitoring',
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {plexMonitoringUsersQuery.isLoading ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}>
                    Checking…
                  </span>
                ) : plexMonitoringUsersQuery.isError ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}>
                    Error
                  </span>
                ) : null}
                <SavingPill
                  active={savePlexMonitoringUsersMutation.isPending}
                  className="static"
                />
              </div>
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Choose which Plex users Immaculaterr should monitor for task
              triggers. Users turned off here won&apos;t trigger Plex-based
              automation.
            </p>

            {plexMonitoringUsersQuery.data?.warning ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-yellow-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{plexMonitoringUsersQuery.data.warning}</span>
              </div>
            ) : null}

            {plexMonitoringUsersQuery.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{(plexMonitoringUsersQuery.error as Error).message}</span>
              </div>
            ) : null}

            {!plexMonitoringUsersQuery.isLoading &&
            !plexMonitoringUsersQuery.isError &&
            !(plexMonitoringUsersQuery.data?.users.length ?? 0) ? (
              <div className="mt-4 text-sm text-white/70">
                No Plex users available right now.
              </div>
            ) : null}

            {!plexMonitoringUsersQuery.isLoading &&
            !plexMonitoringUsersQuery.isError &&
            (plexMonitoringUsersQuery.data?.users.length ?? 0) > 0 ? (
              <div className="mt-5 space-y-4">
                <div className="text-xs text-white/55">
                  Enabled {draftSelectedPlexUserIds.length} of{' '}
                  {plexMonitoringUsersQuery.data?.users.length ?? 0}.
                </div>

                <div className="space-y-2">
                  {(plexMonitoringUsersQuery.data?.users ?? []).map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/85"
                    >
                      <input
                        type="checkbox"
                        checked={draftSelectedPlexUserIds.includes(user.id)}
                        data-plex-user-id={user.id}
                        onChange={handlePlexUserCheckboxChange}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-[#facc15] focus:ring-[#facc15] focus:ring-offset-0"
                      />
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {user.plexAccountTitle}
                      </span>
                      {user.isAdmin ? (
                        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/60">
                          Admin
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>

                {savePlexMonitoringUsersMutation.isError ? (
                  <div className="flex items-start gap-2 text-sm text-red-200/90">
                    <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      {(savePlexMonitoringUsersMutation.error as Error).message}
                    </span>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={resetPlexUserSelectionDraft}
                    disabled={
                      savePlexMonitoringUsersMutation.isPending ||
                      !plexUserSelectionDirty
                    }
                    className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={savePlexUserSelectionDraft}
                    disabled={
                      savePlexMonitoringUsersMutation.isPending ||
                      !plexUserSelectionDirty
                    }
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#facc15] px-4 py-2 text-sm font-bold text-black shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                  >
                    {savePlexMonitoringUsersMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      'Save selection'
                    )}
                  </button>
                </div>
              </div>
            ) : null}
            </div>
          </div>

          {/* Immaculate Taste Profiles */}
          <div id="command-center-immaculate-taste-profiles" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-immaculate-taste-profiles')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-fuchsia-400/10 focus-within:border-white/15 focus-within:shadow-fuchsia-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-fuchsia-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-fuchsia-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <Film className="w-7 h-7" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                    Immaculate Taste Profiles
                  </h2>
                  {renderFeatureFaqButton(
                    'command-center-immaculate-taste-profiles',
                    'Immaculate Taste Profiles',
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {immaculateProfilesQuery.isLoading ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}>
                    Loading…
                  </span>
                ) : immaculateProfilesQuery.isError ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}>
                    Error
                  </span>
                ) : (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-emerald-500/15 text-emerald-200 border-emerald-500/20`}>
                    {immaculateProfiles.length} profile{immaculateProfiles.length === 1 ? '' : 's'}
                  </span>
                )}
                <SavingPill
                  active={
                    createImmaculateProfileMutation.isPending ||
                    saveImmaculateProfileMutation.isPending ||
                    deleteImmaculateProfileMutation.isPending
                  }
                  className="static"
                />
              </div>
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Manage matching filters, ARR service routing, and collection naming per taste profile.
            </p>

            {immaculateProfilesQuery.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{(immaculateProfilesQuery.error as Error).message}</span>
              </div>
            ) : null}

            {!immaculateProfilesQuery.isError ? (
              <div className="mt-5 space-y-5">
                <div className="space-y-3">
                  {immaculateProfiles.map((profile) => {
                    const isActive = activeProfileId === profile.id;
                    const isEditingThisProfile =
                      isActive && isProfileEditorOpen && activeProfile && profileDraft;
                    const isProfileEnabled =
                      isEditingThisProfile && profileDraft
                        ? profileDraft.enabled
                        : profile.enabled;
                    const hasOtherProfile = immaculateProfiles.some(
                      (candidate) => candidate.id !== profile.id,
                    );
                    const hasEnabledFallback = immaculateProfiles.some(
                      (candidate) => candidate.id !== profile.id && candidate.enabled,
                    );
                    const defaultDisableLocked =
                      profile.isDefault && isProfileEnabled && !hasEnabledFallback;
                    const lockedToggleReason = defaultDisableLocked
                      ? hasOtherProfile
                        ? 'Default profile cannot be disabled until another profile is enabled.'
                        : 'Default profile cannot be disabled because no other profile exists.'
                      : undefined;
                    const toggleDisabled =
                      saveImmaculateProfileMutation.isPending ||
                      deleteImmaculateProfileMutation.isPending ||
                      Boolean(isEditingThisProfile && activeProfileScopePlexUserId) ||
                      defaultDisableLocked;
                    return (
                      <div
                        key={profile.id}
                        ref={isEditingThisProfile ? profileEditorCardRef : undefined}
                        className={`rounded-2xl border px-4 py-3 transition ${
                          isEditingThisProfile
                            ? 'border-white/20 bg-white/10'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <div className="w-full flex items-start justify-between gap-4">
                          <button
                            type="button"
                            onClick={() => selectImmaculateProfile(profile)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold text-white truncate">
                                {profile.name}
                              </div>
                              {!profile.enabled ? (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-white/10 text-white/70 border border-white/20">
                                  Disabled
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-xs text-white/60">
                              {profile.mediaType === 'both'
                                ? 'Movies + TV'
                                : profile.mediaType === 'movie'
                                  ? 'Movies only'
                                  : 'TV only'}{' '}
                              •{' '}
                              {profile.matchMode === 'all'
                                ? 'Match all filters'
                                : 'Match any filter'}
                            </div>
                          </button>
                          {(!profile.isDefault || immaculateProfiles.length > 1) && (
                            <span
                              className="inline-flex"
                              title={lockedToggleReason}
                              aria-label={lockedToggleReason}
                            >
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isProfileEnabled}
                                disabled={toggleDisabled}
                                onClick={() => handleProfileEnabledToggle(profile)}
                                className={[
                                  'relative inline-flex h-7 w-12 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                  isProfileEnabled
                                    ? 'border-emerald-400/40 bg-emerald-400/20'
                                    : 'border-white/20 bg-white/10',
                                ].join(' ')}
                                aria-label={`Toggle ${profile.name} enabled`}
                              >
                                <span
                                  className={[
                                    'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                                    isProfileEnabled
                                      ? 'translate-x-6'
                                      : 'translate-x-0.5',
                                  ].join(' ')}
                                />
                              </button>
                            </span>
                          )}
                        </div>

                        {isActive && isProfileEditorOpen && activeProfile && profileDraft ? (
                          <div className="mt-4 border-t border-white/10 pt-4 space-y-4">
                            <div className="space-y-2">
                              <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                User scope
                              </div>
                              <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => selectActiveProfileScopeUser(null)}
                                    disabled={
                                      updateProfileScopeMutation.isPending ||
                                      saveImmaculateProfileMutation.isPending ||
                                      deleteImmaculateProfileMutation.isPending
                                    }
                                    className={[
                                      'inline-flex h-6 items-center rounded-full border px-2 text-[11px] transition disabled:opacity-60 disabled:cursor-not-allowed',
                                      !activeProfileScopePlexUserId
                                        ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100'
                                        : 'border-white/15 bg-white/5 text-white/75 hover:bg-white/10',
                                    ].join(' ')}
                                  >
                                    All users
                                  </button>
                                  {profileScopeSelectedUsers.map((user) => (
                                    <span
                                      key={user.id}
                                      className={[
                                        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]',
                                        activeProfileScopePlexUserId === user.id
                                          ? 'border-sky-500/30 bg-sky-500/15 text-sky-100'
                                          : 'border-white/15 bg-white/5 text-white/75',
                                      ].join(' ')}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => selectActiveProfileScopeUser(user.id)}
                                        disabled={
                                          updateProfileScopeMutation.isPending ||
                                          saveImmaculateProfileMutation.isPending ||
                                          deleteImmaculateProfileMutation.isPending
                                        }
                                        className="rounded px-0.5 leading-none transition hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                                      >
                                        {user.plexAccountTitle}
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`Remove ${user.plexAccountTitle} from profile scope`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          removeActiveProfileScopeUser(user.id);
                                        }}
                                        disabled={
                                          updateProfileScopeMutation.isPending ||
                                          saveImmaculateProfileMutation.isPending ||
                                          deleteImmaculateProfileMutation.isPending
                                        }
                                        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-sky-100/85 hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed"
                                      >
                                        <X className="h-2.5 w-2.5" />
                                      </button>
                                    </span>
                                  ))}
                                  <input
                                    type="text"
                                    value={profileScopeSearch}
                                    onChange={(event) => setProfileScopeSearch(event.target.value)}
                                    placeholder="Search users to add to scope"
                                    className="min-w-[12rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                  />
                                </div>
                              </div>
                              {activeProfileScopePlexUserId ? (
                                <div className="text-[11px] text-sky-200/80">
                                  Editing scoped settings for the selected user.
                                </div>
                              ) : (
                                <div className="text-[11px] text-white/45">
                                  Editing shared profile settings for all users in scope.
                                </div>
                              )}
                              <div className="flex flex-wrap gap-1.5">
                                {profileScopeSearchResults.map((user) => (
                                  <button
                                    key={user.id}
                                    type="button"
                                    onClick={() => addActiveProfileScopeUser(user.id)}
                                    disabled={
                                      updateProfileScopeMutation.isPending ||
                                      saveImmaculateProfileMutation.isPending ||
                                      deleteImmaculateProfileMutation.isPending
                                    }
                                    className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 transition hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed"
                                  >
                                    {user.plexAccountTitle}
                                  </button>
                                ))}
                                {trimmedProfileScopeSearch && !profileScopeSearchResults.length ? (
                                  <span className="text-[11px] text-white/45">
                                    No users match "{profileScopeSearch.trim()}"
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Profile name
                                </div>
                                <input
                                  type="text"
                                  value={profileDraft.name}
                                  onChange={(event) =>
                                    setProfileDraft((current) =>
                                      current ? { ...current, name: event.target.value } : current,
                                    )
                                  }
                                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-[#facc15]/40 focus:border-[#facc15]/40"
                                />
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                    Media type
                                  </div>
                                  <Select
                                    value={profileDraft.mediaType}
                                    onValueChange={(value) =>
                                      setProfileDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              mediaType:
                                                value === 'movie' ||
                                                value === 'show' ||
                                                value === 'both'
                                                  ? value
                                                  : current.mediaType,
                                            }
                                          : current,
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select media type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="both">Movies + TV</SelectItem>
                                      <SelectItem value="movie">Movies only</SelectItem>
                                      <SelectItem value="show">TV only</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                    Match mode
                                  </div>
                                  <Select
                                    value={profileDraft.matchMode}
                                    onValueChange={(value) =>
                                      setProfileDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              matchMode:
                                                value === 'all' || value === 'any'
                                                  ? value
                                                  : current.matchMode,
                                            }
                                          : current,
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select match mode" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="all">Match all filters</SelectItem>
                                      <SelectItem value="any">Match any filter</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                    Only Include Genres
                                  </div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={profileDraft.includeGenreFilterEnabled}
                                    onClick={() =>
                                      setProfileDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              includeGenreFilterEnabled: !current.includeGenreFilterEnabled,
                                            }
                                          : current,
                                      )
                                    }
                                    className={[
                                      'relative inline-flex h-6 w-11 rounded-full border transition-colors',
                                      profileDraft.includeGenreFilterEnabled
                                        ? 'border-sky-400/40 bg-sky-400/20'
                                        : 'border-white/20 bg-white/10',
                                    ].join(' ')}
                                    aria-label="Toggle included genre filter"
                                  >
                                    <span
                                      className={[
                                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                        profileDraft.includeGenreFilterEnabled
                                          ? 'translate-x-5'
                                          : 'translate-x-0.5',
                                      ].join(' ')}
                                    />
                                  </button>
                                </div>
                                {profileDraft.includeGenreFilterEnabled ? (
                                  <div className="space-y-2">
                                    <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {selectedGenres.map((genre) => (
                                          <span
                                            key={genre}
                                            className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-1 text-[11px] text-sky-100"
                                          >
                                            {genre}
                                            <button
                                              type="button"
                                              onClick={() => removeIncludedGenreTag(genre)}
                                              className="inline-flex items-center justify-center rounded-full p-0.5 text-sky-100/80 hover:text-white hover:bg-white/10 transition"
                                              aria-label={`Remove ${genre}`}
                                              title={`Remove ${genre}`}
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </span>
                                        ))}
                                        <input
                                          type="text"
                                          value={genreSearch}
                                          onChange={(event) => setGenreSearch(event.target.value)}
                                          onKeyDown={handleIncludedGenreSearchKeyDown}
                                          placeholder="Search and add genre"
                                          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                        />
                                      </div>
                                    </div>
                                    {genreSearchIsActive || defaultGenreOptions.length ? (
                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                                        {genreSearchIsActive
                                          ? 'Genre search results'
                                          : 'Recommended genres to include'}
                                      </div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-1.5">
                                      {(genreSearchIsActive
                                        ? filteredGenreOptions
                                        : defaultGenreOptions
                                      ).map((genre) => (
                                        <button
                                          key={genre}
                                          type="button"
                                          onClick={() => addSuggestedIncludedGenre(genre)}
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                        >
                                          + {genre}
                                        </button>
                                      ))}
                                      {genreSearchIsActive &&
                                      !filteredGenreOptions.length &&
                                      trimmedGenreSearch ? (
                                        <button
                                          type="button"
                                          onClick={() => addSuggestedIncludedGenre(trimmedGenreSearch)}
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                        >
                                          + Add "{trimmedGenreSearch}"
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                    Only Include Audio Languages
                                  </div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={profileDraft.includeAudioLanguageFilterEnabled}
                                    onClick={() =>
                                      setProfileDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              includeAudioLanguageFilterEnabled:
                                                !current.includeAudioLanguageFilterEnabled,
                                            }
                                          : current,
                                      )
                                    }
                                    className={[
                                      'relative inline-flex h-6 w-11 rounded-full border transition-colors',
                                      profileDraft.includeAudioLanguageFilterEnabled
                                        ? 'border-fuchsia-400/40 bg-fuchsia-400/20'
                                        : 'border-white/20 bg-white/10',
                                    ].join(' ')}
                                    aria-label="Toggle included audio language filter"
                                  >
                                    <span
                                      className={[
                                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                        profileDraft.includeAudioLanguageFilterEnabled
                                          ? 'translate-x-5'
                                          : 'translate-x-0.5',
                                      ].join(' ')}
                                    />
                                  </button>
                                </div>
                                {profileDraft.includeAudioLanguageFilterEnabled ? (
                                  <div className="space-y-2">
                                    <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {selectedAudioLanguages.map((language) => (
                                          <span
                                            key={language}
                                            className="inline-flex items-center gap-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/15 px-2 py-1 text-[11px] text-fuchsia-100"
                                          >
                                            {language}
                                            <button
                                              type="button"
                                              onClick={() => removeIncludedAudioLanguageTag(language)}
                                              className="inline-flex items-center justify-center rounded-full p-0.5 text-fuchsia-100/80 hover:text-white hover:bg-white/10 transition"
                                              aria-label={`Remove ${language}`}
                                              title={`Remove ${language}`}
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </span>
                                        ))}
                                        <input
                                          type="text"
                                          value={audioLanguageSearch}
                                          onChange={(event) =>
                                            setAudioLanguageSearch(event.target.value)
                                          }
                                          onKeyDown={handleIncludedAudioLanguageSearchKeyDown}
                                          placeholder="Search and add language"
                                          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                        />
                                      </div>
                                    </div>
                                    {audioLanguageSearchIsActive ||
                                    defaultAudioLanguageOptions.length ? (
                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                                        {audioLanguageSearchIsActive
                                          ? 'Language search results'
                                          : 'Top 10 popular languages to include'}
                                      </div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-1.5">
                                      {(audioLanguageSearchIsActive
                                        ? filteredAudioLanguageOptions
                                        : defaultAudioLanguageOptions
                                      ).map((language) => (
                                        <button
                                          key={language}
                                          type="button"
                                          onClick={() => addIncludedAudioLanguageTag(language)}
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                        >
                                          + {language}
                                        </button>
                                      ))}
                                      {audioLanguageSearchIsActive &&
                                      !filteredAudioLanguageOptions.length &&
                                      trimmedAudioLanguageSearch ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            addIncludedAudioLanguageTag(trimmedAudioLanguageSearch)
                                          }
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                        >
                                          + Add "{trimmedAudioLanguageSearch}"
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                    Excluded genres
                                  </div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={profileDraft.excludeGenreFilterEnabled}
                                    onClick={() =>
                                      setProfileDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              excludeGenreFilterEnabled:
                                                !current.excludeGenreFilterEnabled,
                                            }
                                          : current,
                                      )
                                    }
                                    className={[
                                      'relative inline-flex h-6 w-11 rounded-full border transition-colors',
                                      profileDraft.excludeGenreFilterEnabled
                                        ? 'border-rose-400/40 bg-rose-400/20'
                                        : 'border-white/20 bg-white/10',
                                    ].join(' ')}
                                    aria-label="Toggle excluded genre filter"
                                  >
                                    <span
                                      className={[
                                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                        profileDraft.excludeGenreFilterEnabled
                                          ? 'translate-x-5'
                                          : 'translate-x-0.5',
                                      ].join(' ')}
                                    />
                                  </button>
                                </div>
                                {profileDraft.excludeGenreFilterEnabled ? (
                                  <div className="space-y-2">
                                    <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {selectedExcludedGenres.map((genre) => (
                                          <span
                                            key={genre}
                                            className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-100"
                                          >
                                            {genre}
                                            <button
                                              type="button"
                                              onClick={() => removeExcludedGenreTag(genre)}
                                              className="inline-flex items-center justify-center rounded-full p-0.5 text-rose-100/80 hover:text-white hover:bg-white/10 transition"
                                              aria-label={`Remove ${genre}`}
                                              title={`Remove ${genre}`}
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </span>
                                        ))}
                                        <input
                                          type="text"
                                          value={excludeGenreSearch}
                                          onChange={(event) =>
                                            setExcludeGenreSearch(event.target.value)
                                          }
                                          onKeyDown={handleExcludedGenreSearchKeyDown}
                                          placeholder="Search and add excluded genre"
                                          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                        />
                                      </div>
                                    </div>
                                    {excludeGenreSearchIsActive ||
                                    defaultExcludedGenreOptions.length ? (
                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                                        {excludeGenreSearchIsActive
                                          ? 'Genre search results'
                                          : 'Recommended genres to exclude'}
                                      </div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-1.5">
                                      {(excludeGenreSearchIsActive
                                        ? filteredExcludedGenreOptions
                                        : defaultExcludedGenreOptions
                                      ).map((genre) => (
                                        <button
                                          key={genre}
                                          type="button"
                                          onClick={() => addSuggestedExcludedGenre(genre)}
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                        >
                                          + {genre}
                                        </button>
                                      ))}
                                      {excludeGenreSearchIsActive &&
                                      !filteredExcludedGenreOptions.length &&
                                      trimmedExcludeGenreSearch ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            addSuggestedExcludedGenre(trimmedExcludeGenreSearch)
                                          }
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                        >
                                          + Add "{trimmedExcludeGenreSearch}"
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                              <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                    Excluded audio languages
                                  </div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={profileDraft.excludeAudioLanguageFilterEnabled}
                                    onClick={() =>
                                      setProfileDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              excludeAudioLanguageFilterEnabled:
                                                !current.excludeAudioLanguageFilterEnabled,
                                            }
                                          : current,
                                      )
                                    }
                                    className={[
                                      'relative inline-flex h-6 w-11 rounded-full border transition-colors',
                                      profileDraft.excludeAudioLanguageFilterEnabled
                                        ? 'border-amber-400/40 bg-amber-400/20'
                                        : 'border-white/20 bg-white/10',
                                    ].join(' ')}
                                    aria-label="Toggle excluded audio language filter"
                                  >
                                    <span
                                      className={[
                                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                        profileDraft.excludeAudioLanguageFilterEnabled
                                          ? 'translate-x-5'
                                          : 'translate-x-0.5',
                                      ].join(' ')}
                                    />
                                  </button>
                                </div>
                                {profileDraft.excludeAudioLanguageFilterEnabled ? (
                                  <div className="space-y-2">
                                    <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {selectedExcludedAudioLanguages.map((language) => (
                                          <span
                                            key={language}
                                            className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-100"
                                          >
                                            {language}
                                            <button
                                              type="button"
                                              onClick={() =>
                                                removeExcludedAudioLanguageTag(language)
                                              }
                                              className="inline-flex items-center justify-center rounded-full p-0.5 text-amber-100/80 hover:text-white hover:bg-white/10 transition"
                                              aria-label={`Remove ${language}`}
                                              title={`Remove ${language}`}
                                            >
                                              <X className="w-3 h-3" />
                                            </button>
                                          </span>
                                        ))}
                                        <input
                                          type="text"
                                          value={excludeAudioLanguageSearch}
                                          onChange={(event) =>
                                            setExcludeAudioLanguageSearch(event.target.value)
                                          }
                                          onKeyDown={handleExcludedAudioLanguageSearchKeyDown}
                                          placeholder="Search and add excluded language"
                                          className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                        />
                                      </div>
                                    </div>
                                    {excludeAudioLanguageSearchIsActive ||
                                    defaultExcludedAudioLanguageOptions.length ? (
                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                                        {excludeAudioLanguageSearchIsActive
                                          ? 'Language search results'
                                          : 'Top 10 popular languages to exclude'}
                                      </div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-1.5">
                                      {(excludeAudioLanguageSearchIsActive
                                        ? filteredExcludedAudioLanguageOptions
                                        : defaultExcludedAudioLanguageOptions
                                      ).map((language) => (
                                        <button
                                          key={language}
                                          type="button"
                                          onClick={() => addSuggestedExcludedAudioLanguage(language)}
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                        >
                                          + {language}
                                        </button>
                                      ))}
                                      {excludeAudioLanguageSearchIsActive &&
                                      !filteredExcludedAudioLanguageOptions.length &&
                                      trimmedExcludeAudioLanguageSearch ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            addSuggestedExcludedAudioLanguage(
                                              trimmedExcludeAudioLanguageSearch,
                                            )
                                          }
                                          className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                        >
                                          + Add "{trimmedExcludeAudioLanguageSearch}"
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            {showRadarrServiceSelector || showSonarrServiceSelector ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {showRadarrServiceSelector ? (
                                  <div>
                                    <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                      Radarr service
                                    </div>
                                    <Select
                                      value={profileDraft.radarrInstanceId}
                                      onValueChange={(value) =>
                                        setProfileDraft((current) =>
                                          current
                                            ? { ...current, radarrInstanceId: value }
                                            : current,
                                        )
                                      }
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select Radarr service" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={PRIMARY_INSTANCE_SENTINEL}>
                                          Primary Radarr
                                        </SelectItem>
                                        {activeRadarrInstanceOptions
                                          .filter((instance) => !instance.isPrimary)
                                          .map((instance) => (
                                            <SelectItem key={instance.id} value={instance.id}>
                                              {instance.name}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : null}
                                {showSonarrServiceSelector ? (
                                  <div>
                                    <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                      Sonarr service
                                    </div>
                                    <Select
                                      value={profileDraft.sonarrInstanceId}
                                      onValueChange={(value) =>
                                        setProfileDraft((current) =>
                                          current
                                            ? { ...current, sonarrInstanceId: value }
                                            : current,
                                        )
                                      }
                                    >
                                      <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select Sonarr service" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={PRIMARY_INSTANCE_SENTINEL}>
                                          Primary Sonarr
                                        </SelectItem>
                                        {activeSonarrInstanceOptions
                                          .filter((instance) => !instance.isPrimary)
                                          .map((instance) => (
                                            <SelectItem key={instance.id} value={instance.id}>
                                              {instance.name}
                                            </SelectItem>
                                          ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            <div
                              className={`grid grid-cols-1 gap-4 ${
                                profileDraft.mediaType === 'both' ? 'md:grid-cols-2' : ''
                              }`}
                            >
                              {profileDraft.mediaType !== 'show' ? (
                                <div>
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                    Movie collection base name
                                  </div>
                                  <input
                                    type="text"
                                    value={profileDraft.movieCollectionBaseName}
                                    onChange={(event) =>
                                      setProfileDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              movieCollectionBaseName: event.target.value,
                                            }
                                          : current,
                                      )
                                    }
                                    placeholder={DEFAULT_IMMACULATE_MOVIE_COLLECTION_BASE_NAME}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-[#facc15]/40 focus:border-[#facc15]/40"
                                  />
                                </div>
                              ) : null}
                              {profileDraft.mediaType !== 'movie' ? (
                                <div>
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                    TV collection base name
                                  </div>
                                  <input
                                    type="text"
                                    value={profileDraft.showCollectionBaseName}
                                    onChange={(event) =>
                                      setProfileDraft((current) =>
                                        current
                                          ? {
                                              ...current,
                                              showCollectionBaseName: event.target.value,
                                            }
                                          : current,
                                      )
                                    }
                                    placeholder={DEFAULT_IMMACULATE_SHOW_COLLECTION_BASE_NAME}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-[#facc15]/40 focus:border-[#facc15]/40"
                                  />
                                </div>
                              ) : null}
                            </div>

                            {(saveImmaculateProfileMutation.isError ||
                              deleteImmaculateProfileMutation.isError) && (
                              <div className="text-sm text-red-200/90">
                                {(saveImmaculateProfileMutation.error as Error)?.message ||
                                  (deleteImmaculateProfileMutation.error as Error)?.message}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={closeProfileEditor}
                                disabled={
                                  saveImmaculateProfileMutation.isPending ||
                                  deleteImmaculateProfileMutation.isPending
                                }
                                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 transition disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                Cancel
                              </button>
                              {activeProfile.isDefault ? (
                                <button
                                  type="button"
                                  onClick={resetProfileDraft}
                                  disabled={
                                    defaultProfileAtNetZero ||
                                    saveImmaculateProfileMutation.isPending ||
                                    deleteImmaculateProfileMutation.isPending
                                  }
                                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 transition disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  Reset default profile
                                </button>
                              ) : null}
                              {!activeProfile.isDefault ? (
                                <button
                                  type="button"
                                  onClick={handleDeleteActiveProfile}
                                  disabled={
                                    saveImmaculateProfileMutation.isPending ||
                                    deleteImmaculateProfileMutation.isPending
                                  }
                                  className="rounded-xl border border-rose-500/35 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/30 transition disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {deleteImmaculateProfileMutation.isPending
                                    ? 'Deleting…'
                                    : 'Delete'}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={handleSaveActiveProfile}
                                disabled={
                                  !profileDirty ||
                                  saveImmaculateProfileMutation.isPending ||
                                  deleteImmaculateProfileMutation.isPending
                                }
                                className="rounded-xl bg-[#facc15] px-4 py-2 text-sm font-bold text-black shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                              >
                                {saveImmaculateProfileMutation.isPending
                                  ? 'Saving…'
                                  : 'Save profile'}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {isAddProfileFormOpen && newProfileDraft ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">New profile</div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={newProfileDraft.enabled}
                              onClick={() =>
                                setNewProfileDraft((current) =>
                                  current ? { ...current, enabled: !current.enabled } : current,
                                )
                              }
                              className={[
                                'relative inline-flex h-7 w-12 rounded-full border transition-colors',
                                newProfileDraft.enabled
                                  ? 'border-emerald-400/40 bg-emerald-400/20'
                                  : 'border-white/20 bg-white/10',
                              ].join(' ')}
                              aria-label="Toggle new profile enabled"
                            >
                              <span
                                className={[
                                  'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                                  newProfileDraft.enabled ? 'translate-x-6' : 'translate-x-0.5',
                                ].join(' ')}
                              />
                            </button>
                          </div>

                          <div className="space-y-2">
                            <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                              User scope
                            </div>
                            <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {!newProfileScopeSelectedUsers.length ? (
                                  <span className="inline-flex h-6 items-center rounded-full border border-emerald-500/35 bg-emerald-500/15 px-2 text-[11px] text-emerald-100">
                                    All users
                                  </span>
                                ) : null}
                                {newProfileScopeSelectedUsers.map((user) => (
                                  <span
                                    key={user.id}
                                    className="inline-flex h-6 items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 text-[11px] text-sky-100"
                                  >
                                    <span>{user.plexAccountTitle}</span>
                                    <button
                                      type="button"
                                      aria-label={`Remove ${user.plexAccountTitle} from profile scope`}
                                      onClick={() => removeNewProfileScopeUser(user.id)}
                                      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-sky-100/85 hover:bg-white/10"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  </span>
                                ))}
                                <input
                                  type="text"
                                  value={newProfileScopeSearch}
                                  onChange={(event) =>
                                    setNewProfileScopeSearch(event.target.value)
                                  }
                                  placeholder="Search users to add to scope"
                                  className="min-w-[12rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {newProfileScopeSearchResults.map((user) => (
                                <button
                                  key={user.id}
                                  type="button"
                                  onClick={() => addNewProfileScopeUser(user.id)}
                                  className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 transition hover:bg-white/10"
                                >
                                  {user.plexAccountTitle}
                                </button>
                              ))}
                              {trimmedNewProfileScopeSearch &&
                              !newProfileScopeSearchResults.length ? (
                                <span className="text-[11px] text-white/45">
                                  No users match "{newProfileScopeSearch.trim()}"
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                Profile name
                              </div>
                              <input
                                type="text"
                                value={newProfileDraft.name}
                                onChange={(event) =>
                                  setNewProfileDraft((current) =>
                                    current ? { ...current, name: event.target.value } : current,
                                  )
                                }
                                placeholder="e.g. Action + English"
                                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-[#facc15]/40 focus:border-[#facc15]/40"
                              />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Media type
                                </div>
                                <Select
                                  value={newProfileDraft.mediaType}
                                  onValueChange={(value) =>
                                    setNewProfileDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            mediaType:
                                              value === 'movie' ||
                                              value === 'show' ||
                                              value === 'both'
                                                ? value
                                                : current.mediaType,
                                          }
                                        : current,
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select media type" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="both">Movies + TV</SelectItem>
                                    <SelectItem value="movie">Movies only</SelectItem>
                                    <SelectItem value="show">TV only</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Match mode
                                </div>
                                <Select
                                  value={newProfileDraft.matchMode}
                                  onValueChange={(value) =>
                                    setNewProfileDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            matchMode:
                                              value === 'all' || value === 'any'
                                                ? value
                                                : current.matchMode,
                                          }
                                        : current,
                                    )
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select match mode" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="all">Match all filters</SelectItem>
                                    <SelectItem value="any">Match any filter</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                  Only Include Genres
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={newProfileDraft.includeGenreFilterEnabled}
                                  onClick={() =>
                                    setNewProfileDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            includeGenreFilterEnabled: !current.includeGenreFilterEnabled,
                                          }
                                        : current,
                                    )
                                  }
                                  className={[
                                    'relative inline-flex h-6 w-11 rounded-full border transition-colors',
                                    newProfileDraft.includeGenreFilterEnabled
                                      ? 'border-sky-400/40 bg-sky-400/20'
                                      : 'border-white/20 bg-white/10',
                                  ].join(' ')}
                                  aria-label="Toggle new profile included genre filter"
                                >
                                  <span
                                    className={[
                                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                      newProfileDraft.includeGenreFilterEnabled
                                        ? 'translate-x-5'
                                        : 'translate-x-0.5',
                                    ].join(' ')}
                                  />
                                </button>
                              </div>
                              {newProfileDraft.includeGenreFilterEnabled ? (
                                <div className="space-y-2">
                                  <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {newProfileSelectedGenres.map((genre) => (
                                        <span
                                          key={genre}
                                          className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-1 text-[11px] text-sky-100"
                                        >
                                          {genre}
                                          <button
                                            type="button"
                                            onClick={() => removeNewProfileIncludedGenreTag(genre)}
                                            className="inline-flex items-center justify-center rounded-full p-0.5 text-sky-100/80 hover:text-white hover:bg-white/10 transition"
                                            aria-label={`Remove ${genre}`}
                                            title={`Remove ${genre}`}
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </span>
                                      ))}
                                      <input
                                        type="text"
                                        value={newProfileGenreSearch}
                                        onChange={(event) =>
                                          setNewProfileGenreSearch(event.target.value)
                                        }
                                        onKeyDown={handleNewProfileIncludedGenreSearchKeyDown}
                                        placeholder="Search and add genre"
                                        className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                  {newProfileGenreSearchIsActive ||
                                  newProfileDefaultGenreOptions.length ? (
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                                      {newProfileGenreSearchIsActive
                                        ? 'Genre search results'
                                        : 'Recommended genres to include'}
                                    </div>
                                  ) : null}
                                  <div className="flex flex-wrap gap-1.5">
                                    {(newProfileGenreSearchIsActive
                                      ? newProfileFilteredGenreOptions
                                      : newProfileDefaultGenreOptions
                                    ).map((genre) => (
                                      <button
                                        key={genre}
                                        type="button"
                                        onClick={() => addNewProfileIncludedGenreTag(genre)}
                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                      >
                                        + {genre}
                                      </button>
                                    ))}
                                    {newProfileGenreSearchIsActive &&
                                    !newProfileFilteredGenreOptions.length &&
                                    trimmedNewProfileGenreSearch ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          addNewProfileIncludedGenreTag(trimmedNewProfileGenreSearch)
                                        }
                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                      >
                                        + Add "{trimmedNewProfileGenreSearch}"
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div>
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                  Only Include Audio Languages
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={newProfileDraft.includeAudioLanguageFilterEnabled}
                                  onClick={() =>
                                    setNewProfileDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            includeAudioLanguageFilterEnabled:
                                              !current.includeAudioLanguageFilterEnabled,
                                          }
                                        : current,
                                    )
                                  }
                                  className={[
                                    'relative inline-flex h-6 w-11 rounded-full border transition-colors',
                                    newProfileDraft.includeAudioLanguageFilterEnabled
                                      ? 'border-fuchsia-400/40 bg-fuchsia-400/20'
                                      : 'border-white/20 bg-white/10',
                                  ].join(' ')}
                                  aria-label="Toggle new profile included audio language filter"
                                >
                                  <span
                                    className={[
                                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                      newProfileDraft.includeAudioLanguageFilterEnabled
                                        ? 'translate-x-5'
                                        : 'translate-x-0.5',
                                    ].join(' ')}
                                  />
                                </button>
                              </div>
                              {newProfileDraft.includeAudioLanguageFilterEnabled ? (
                                <div className="space-y-2">
                                  <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {newProfileSelectedAudioLanguages.map((language) => (
                                        <span
                                          key={language}
                                          className="inline-flex items-center gap-1 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/15 px-2 py-1 text-[11px] text-fuchsia-100"
                                        >
                                          {language}
                                          <button
                                            type="button"
                                            onClick={() =>
                                              removeNewProfileIncludedAudioLanguageTag(language)
                                            }
                                            className="inline-flex items-center justify-center rounded-full p-0.5 text-fuchsia-100/80 hover:text-white hover:bg-white/10 transition"
                                            aria-label={`Remove ${language}`}
                                            title={`Remove ${language}`}
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </span>
                                      ))}
                                      <input
                                        type="text"
                                        value={newProfileAudioLanguageSearch}
                                        onChange={(event) =>
                                          setNewProfileAudioLanguageSearch(event.target.value)
                                        }
                                        onKeyDown={
                                          handleNewProfileIncludedAudioLanguageSearchKeyDown
                                        }
                                        placeholder="Search and add language"
                                        className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                  {newProfileAudioLanguageSearchIsActive ||
                                  newProfileDefaultAudioLanguageOptions.length ? (
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                                      {newProfileAudioLanguageSearchIsActive
                                        ? 'Language search results'
                                        : 'Top 10 popular languages to include'}
                                    </div>
                                  ) : null}
                                  <div className="flex flex-wrap gap-1.5">
                                    {(newProfileAudioLanguageSearchIsActive
                                      ? newProfileFilteredAudioLanguageOptions
                                      : newProfileDefaultAudioLanguageOptions
                                    ).map((language) => (
                                      <button
                                        key={language}
                                        type="button"
                                        onClick={() => addNewProfileIncludedAudioLanguageTag(language)}
                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                      >
                                        + {language}
                                      </button>
                                    ))}
                                    {newProfileAudioLanguageSearchIsActive &&
                                    !newProfileFilteredAudioLanguageOptions.length &&
                                    trimmedNewProfileAudioLanguageSearch ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          addNewProfileIncludedAudioLanguageTag(
                                            trimmedNewProfileAudioLanguageSearch,
                                          )
                                        }
                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                      >
                                        + Add "{trimmedNewProfileAudioLanguageSearch}"
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                  Excluded genres
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={newProfileDraft.excludeGenreFilterEnabled}
                                  onClick={() =>
                                    setNewProfileDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            excludeGenreFilterEnabled:
                                              !current.excludeGenreFilterEnabled,
                                          }
                                        : current,
                                    )
                                  }
                                  className={[
                                    'relative inline-flex h-6 w-11 rounded-full border transition-colors',
                                    newProfileDraft.excludeGenreFilterEnabled
                                      ? 'border-rose-400/40 bg-rose-400/20'
                                      : 'border-white/20 bg-white/10',
                                  ].join(' ')}
                                  aria-label="Toggle new profile excluded genre filter"
                                >
                                  <span
                                    className={[
                                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                      newProfileDraft.excludeGenreFilterEnabled
                                        ? 'translate-x-5'
                                        : 'translate-x-0.5',
                                    ].join(' ')}
                                  />
                                </button>
                              </div>
                              {newProfileDraft.excludeGenreFilterEnabled ? (
                                <div className="space-y-2">
                                  <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {newProfileSelectedExcludedGenres.map((genre) => (
                                        <span
                                          key={genre}
                                          className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-100"
                                        >
                                          {genre}
                                          <button
                                            type="button"
                                            onClick={() =>
                                              removeNewProfileExcludedGenreTag(genre)
                                            }
                                            className="inline-flex items-center justify-center rounded-full p-0.5 text-rose-100/80 hover:text-white hover:bg-white/10 transition"
                                            aria-label={`Remove ${genre}`}
                                            title={`Remove ${genre}`}
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </span>
                                      ))}
                                      <input
                                        type="text"
                                        value={newProfileExcludeGenreSearch}
                                        onChange={(event) =>
                                          setNewProfileExcludeGenreSearch(event.target.value)
                                        }
                                        onKeyDown={handleNewProfileExcludedGenreSearchKeyDown}
                                        placeholder="Search and add excluded genre"
                                        className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                  {newProfileExcludeGenreSearchIsActive ||
                                  newProfileDefaultExcludedGenreOptions.length ? (
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                                      {newProfileExcludeGenreSearchIsActive
                                        ? 'Genre search results'
                                        : 'Recommended genres to exclude'}
                                    </div>
                                  ) : null}
                                  <div className="flex flex-wrap gap-1.5">
                                    {(newProfileExcludeGenreSearchIsActive
                                      ? newProfileFilteredExcludedGenreOptions
                                      : newProfileDefaultExcludedGenreOptions
                                    ).map((genre) => (
                                      <button
                                        key={genre}
                                        type="button"
                                        onClick={() => addNewProfileExcludedGenreTag(genre)}
                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                      >
                                        + {genre}
                                      </button>
                                    ))}
                                    {newProfileExcludeGenreSearchIsActive &&
                                    !newProfileFilteredExcludedGenreOptions.length &&
                                    trimmedNewProfileExcludeGenreSearch ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          addNewProfileExcludedGenreTag(
                                            trimmedNewProfileExcludeGenreSearch,
                                          )
                                        }
                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                      >
                                        + Add "{trimmedNewProfileExcludeGenreSearch}"
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div>
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                                  Excluded audio languages
                                </div>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={newProfileDraft.excludeAudioLanguageFilterEnabled}
                                  onClick={() =>
                                    setNewProfileDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            excludeAudioLanguageFilterEnabled:
                                              !current.excludeAudioLanguageFilterEnabled,
                                          }
                                        : current,
                                    )
                                  }
                                  className={[
                                    'relative inline-flex h-6 w-11 rounded-full border transition-colors',
                                    newProfileDraft.excludeAudioLanguageFilterEnabled
                                      ? 'border-amber-400/40 bg-amber-400/20'
                                      : 'border-white/20 bg-white/10',
                                  ].join(' ')}
                                  aria-label="Toggle new profile excluded audio language filter"
                                >
                                  <span
                                    className={[
                                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                                      newProfileDraft.excludeAudioLanguageFilterEnabled
                                        ? 'translate-x-5'
                                        : 'translate-x-0.5',
                                    ].join(' ')}
                                  />
                                </button>
                              </div>
                              {newProfileDraft.excludeAudioLanguageFilterEnabled ? (
                                <div className="space-y-2">
                                  <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {newProfileSelectedExcludedAudioLanguages.map((language) => (
                                        <span
                                          key={language}
                                          className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-100"
                                        >
                                          {language}
                                          <button
                                            type="button"
                                            onClick={() =>
                                              removeNewProfileExcludedAudioLanguageTag(language)
                                            }
                                            className="inline-flex items-center justify-center rounded-full p-0.5 text-amber-100/80 hover:text-white hover:bg-white/10 transition"
                                            aria-label={`Remove ${language}`}
                                            title={`Remove ${language}`}
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </span>
                                      ))}
                                      <input
                                        type="text"
                                        value={newProfileExcludeAudioLanguageSearch}
                                        onChange={(event) =>
                                          setNewProfileExcludeAudioLanguageSearch(
                                            event.target.value,
                                          )
                                        }
                                        onKeyDown={
                                          handleNewProfileExcludedAudioLanguageSearchKeyDown
                                        }
                                        placeholder="Search and add excluded language"
                                        className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                  {newProfileExcludeAudioLanguageSearchIsActive ||
                                  newProfileDefaultExcludedAudioLanguageOptions.length ? (
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">
                                      {newProfileExcludeAudioLanguageSearchIsActive
                                        ? 'Language search results'
                                        : 'Top 10 popular languages to exclude'}
                                    </div>
                                  ) : null}
                                  <div className="flex flex-wrap gap-1.5">
                                    {(newProfileExcludeAudioLanguageSearchIsActive
                                      ? newProfileFilteredExcludedAudioLanguageOptions
                                      : newProfileDefaultExcludedAudioLanguageOptions
                                    ).map((language) => (
                                      <button
                                        key={language}
                                        type="button"
                                        onClick={() =>
                                          addNewProfileExcludedAudioLanguageTag(language)
                                        }
                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                      >
                                        + {language}
                                      </button>
                                    ))}
                                    {newProfileExcludeAudioLanguageSearchIsActive &&
                                    !newProfileFilteredExcludedAudioLanguageOptions.length &&
                                    trimmedNewProfileExcludeAudioLanguageSearch ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          addNewProfileExcludedAudioLanguageTag(
                                            trimmedNewProfileExcludeAudioLanguageSearch,
                                          )
                                        }
                                        className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/75 hover:bg-white/10 transition"
                                      >
                                        + Add "{trimmedNewProfileExcludeAudioLanguageSearch}"
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {showNewProfileRadarrServiceSelector ||
                          showNewProfileSonarrServiceSelector ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {showNewProfileRadarrServiceSelector ? (
                                <div>
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                    Radarr service
                                  </div>
                                  <Select
                                    value={newProfileDraft.radarrInstanceId}
                                    onValueChange={(value) =>
                                      setNewProfileDraft((current) =>
                                        current
                                          ? { ...current, radarrInstanceId: value }
                                          : current,
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select Radarr service" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={PRIMARY_INSTANCE_SENTINEL}>
                                        Primary Radarr
                                      </SelectItem>
                                      {activeRadarrInstanceOptions
                                        .filter((instance) => !instance.isPrimary)
                                        .map((instance) => (
                                          <SelectItem key={instance.id} value={instance.id}>
                                            {instance.name}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ) : null}
                              {showNewProfileSonarrServiceSelector ? (
                                <div>
                                  <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                    Sonarr service
                                  </div>
                                  <Select
                                    value={newProfileDraft.sonarrInstanceId}
                                    onValueChange={(value) =>
                                      setNewProfileDraft((current) =>
                                        current
                                          ? { ...current, sonarrInstanceId: value }
                                          : current,
                                      )
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Select Sonarr service" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={PRIMARY_INSTANCE_SENTINEL}>
                                        Primary Sonarr
                                      </SelectItem>
                                      {activeSonarrInstanceOptions
                                        .filter((instance) => !instance.isPrimary)
                                        .map((instance) => (
                                          <SelectItem key={instance.id} value={instance.id}>
                                            {instance.name}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          <div
                            className={`grid grid-cols-1 gap-4 ${
                              newProfileDraft.mediaType === 'both' ? 'md:grid-cols-2' : ''
                            }`}
                          >
                            {newProfileDraft.mediaType !== 'show' ? (
                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Movie collection base name
                                </div>
                                <input
                                  type="text"
                                  value={newProfileDraft.movieCollectionBaseName}
                                  onChange={(event) =>
                                    setNewProfileDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            movieCollectionBaseName: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                  placeholder={DEFAULT_IMMACULATE_MOVIE_COLLECTION_BASE_NAME}
                                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-[#facc15]/40 focus:border-[#facc15]/40"
                                />
                              </div>
                            ) : null}
                            {newProfileDraft.mediaType !== 'movie' ? (
                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  TV collection base name
                                </div>
                                <input
                                  type="text"
                                  value={newProfileDraft.showCollectionBaseName}
                                  onChange={(event) =>
                                    setNewProfileDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            showCollectionBaseName: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                  placeholder={DEFAULT_IMMACULATE_SHOW_COLLECTION_BASE_NAME}
                                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-[#facc15]/40 focus:border-[#facc15]/40"
                                />
                              </div>
                            ) : null}
                          </div>

                          {createImmaculateProfileMutation.isError ? (
                            <div className="text-sm text-red-200/90">
                              {(createImmaculateProfileMutation.error as Error)?.message}
                            </div>
                          ) : null}

                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setIsAddProfileFormOpen(false);
                                setNewProfileDraft(null);
                                setNewProfileScopePlexUserIds([]);
                                setNewProfileScopeSearch('');
                                setNewProfileGenreSearch('');
                                setNewProfileAudioLanguageSearch('');
                                setNewProfileExcludeGenreSearch('');
                                setNewProfileExcludeAudioLanguageSearch('');
                                createImmaculateProfileMutation.reset();
                              }}
                              disabled={createImmaculateProfileMutation.isPending}
                              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 transition disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleCreateProfile}
                              disabled={createImmaculateProfileMutation.isPending}
                              className="rounded-xl bg-[#facc15] px-4 py-2 text-sm font-bold text-black shadow-[0_0_20px_rgba(250,204,21,0.2)] hover:shadow-[0_0_28px_rgba(250,204,21,0.3)] hover:scale-[1.02] transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                            >
                              {createImmaculateProfileMutation.isPending
                                ? 'Creating…'
                                : 'Save profile'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {!isAddProfileFormOpen ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setIsProfileEditorOpen(false);
                          setActiveProfileScopePlexUserId(null);
                          setProfileScopeSearch('');
                          setIsAddProfileFormOpen(true);
                          setNewProfileDraft(createNewProfileDraft());
                          setNewProfileScopePlexUserIds([]);
                          setNewProfileScopeSearch('');
                          setNewProfileGenreSearch('');
                          setNewProfileAudioLanguageSearch('');
                          setNewProfileExcludeGenreSearch('');
                          setNewProfileExcludeAudioLanguageSearch('');
                          createImmaculateProfileMutation.reset();
                        }}
                        className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 transition-colors"
                      >
                        Add profile
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            </div>
          </div>

          {/* Reset Immaculate Taste */}
          <div id="command-center-reset-immaculate-taste-collection" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-reset-immaculate-taste-collection')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-amber-400/10 focus-within:border-white/15 focus-within:shadow-amber-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-amber-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-amber-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <RotateCcw className="w-7 h-7" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                    Reset Immaculate Taste Collection
                  </h2>
                  {renderFeatureFaqButton(
                    'command-center-reset-immaculate-taste-collection',
                    'Reset Immaculate Taste Collection',
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {immaculateCollectionsQuery.isLoading ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}>
                    Checking…
                  </span>
                ) : immaculateCollectionsQuery.isError ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}>
                    Error
                  </span>
                ) : null}

                <SavingPill active={resetImmaculateMutation.isPending} className="static" />
              </div>
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              {hasMultipleImmaculateUsers
                ? 'Select a Plex user. Admin shows per-library resets, other users reset all Immaculaterr collections by media type.'
                : 'Pick a library to reset. This removes the Plex collection and clears its dataset.'}
            </p>

            {immaculateCollectionsQuery.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Couldn’t load Immaculate Taste status. Check Plex settings.</span>
              </div>
            ) : null}

            {hasMultipleImmaculateUsers ? (
              <div className="mt-5 space-y-3">
                {adminImmaculateUser ? (
                  <div
                    className={`rounded-2xl border px-4 py-3 transition ${
                      activeImmaculateUserId === adminImmaculateUser.id
                        ? 'border-white/20 bg-white/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <button
                      type="button"
                      data-plex-user-id={adminImmaculateUser.id}
                      onClick={toggleActiveImmaculateUser}
                      className="group w-full flex items-center justify-between gap-4 text-left"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-[#facc15]/15 text-[#facc15] border border-[#facc15]/30">
                            Admin
                          </span>
                          <div className="text-sm font-semibold text-white truncate">
                            {adminImmaculateUser.plexAccountTitle || 'Admin'}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/70">
                            Movie {adminImmaculateUser.movieCount}
                          </span>
                          <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/70">
                            TV {adminImmaculateUser.tvCount}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                          activeImmaculateUserId === adminImmaculateUser.id
                            ? 'border-white/20 bg-white/15 text-white/85'
                            : 'border-white/10 bg-white/5 text-white/65 group-hover:bg-white/10'
                        }`}
                      >
                        {activeImmaculateUserId === adminImmaculateUser.id ? 'Hide' : 'View'}
                      </span>
                    </button>

                    {activeImmaculateUserId === adminImmaculateUser.id ? (
                      <div className="mt-4 border-t border-white/10 pt-4">
                        {renderAdminCollectionList()}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {nonAdminImmaculateUsers.map((user) => {
                  const isActive = activeImmaculateUserId === user.id;
                  const movieCount = user.movieCount ?? 0;
                  const tvCount = user.tvCount ?? 0;
                  return (
                    <div
                      key={user.id}
                      className={`rounded-2xl border px-4 py-3 transition ${
                        isActive
                          ? 'border-white/20 bg-white/10'
                          : 'border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      <button
                        type="button"
                        data-plex-user-id={user.id}
                        onClick={toggleActiveImmaculateUser}
                        className="group w-full flex items-center justify-between gap-4 text-left"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">
                            {user.plexAccountTitle || 'Plex User'}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/70">
                              Movie {movieCount}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-white/70">
                              TV {tvCount}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                            isActive
                              ? 'border-white/20 bg-white/15 text-white/85'
                              : 'border-white/10 bg-white/5 text-white/65 group-hover:bg-white/10'
                          }`}
                        >
                          {isActive ? 'Hide' : 'View'}
                        </span>
                      </button>

                      {isActive ? (
                        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                          <table className="min-w-[420px] w-full text-sm text-white/80">
                            <thead className="text-[11px] uppercase tracking-wider text-white/55 bg-white/5">
                              <tr>
                                <th className="px-4 py-3 text-left font-semibold">User</th>
                                <th className="px-4 py-3 text-left font-semibold">Movie</th>
                                <th className="px-4 py-3 text-left font-semibold">TV Shows</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                              <tr>
                                <td className="px-4 py-3 font-semibold text-white">
                                  {user.plexAccountTitle || 'Plex User'}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs text-white/70">
                                      {movieCount} items
                                    </span>
                                    <button
                                      type="button"
                                      disabled={resetImmaculateUserMutation.isPending || movieCount === 0}
                                      data-plex-user-id={user.id}
                                      data-plex-user-title={user.plexAccountTitle || 'Plex User'}
                                      data-media-type="movie"
                                      data-total={String(movieCount)}
                                      onClick={openImmaculateUserResetTarget}
                                      className="inline-flex items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/20 hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                      Reset
                                    </button>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs text-white/70">{tvCount} items</span>
                                    <button
                                      type="button"
                                      disabled={resetImmaculateUserMutation.isPending || tvCount === 0}
                                      data-plex-user-id={user.id}
                                      data-plex-user-title={user.plexAccountTitle || 'Plex User'}
                                      data-media-type="tv"
                                      data-total={String(tvCount)}
                                      onClick={openImmaculateUserResetTarget}
                                      className="inline-flex items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-400/20 hover:text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                      Reset
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5">{renderAdminCollectionList()}</div>
            )}
            </div>
          </div>

          {/* Reset Seerr Requests */}
          <div id="command-center-reset-seerr-requests" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-reset-seerr-requests')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-cyan-400/10 focus-within:border-white/15 focus-within:shadow-cyan-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-cyan-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-cyan-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <RotateCcw className="w-7 h-7" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                    Reset Seerr Requests
                  </h2>
                  {renderFeatureFaqButton(
                    'command-center-reset-seerr-requests',
                    'Reset Seerr Requests',
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {settingsQuery.isLoading ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}>
                    Checking…
                  </span>
                ) : settingsQuery.isError ? (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}>
                    Error
                  </span>
                ) : seerrConfigured ? (
                  null
                ) : (
                  <span className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-yellow-400/10 text-yellow-200 border-yellow-400/20`}>
                    Not set up
                  </span>
                )}

                <SavingPill active={resetSeerrMutation.isPending} className="static" />
              </div>
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Delete all Seerr requests, regardless of status.
            </p>

            {settingsQuery.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Couldn&apos;t load settings. Please open{' '}
                  <Link
                    to="/vault#vault-seerr"
                    className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                  >
                    Vault
                  </Link>{' '}
                  and verify Seerr configuration.
                </span>
              </div>
            ) : !seerrConfigured ? (
              <div className="mt-3 text-sm text-white/65">
                Set up Seerr in{' '}
                <Link
                  to="/vault#vault-seerr"
                  className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                >
                  Vault
                </Link>{' '}
                before using this reset.
              </div>
            ) : null}

            {resetSeerrMutation.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{(resetSeerrMutation.error as Error).message}</span>
              </div>
            ) : null}

            <div className="mt-5">
              <button
                type="button"
                disabled={
                  resetSeerrMutation.isPending ||
                  !seerrConfigured ||
                  settingsQuery.isLoading ||
                  settingsQuery.isError
                }
                onClick={openSeerrResetDialog}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
                Reset Seerr requests
              </button>
            </div>
            </div>
          </div>

          {/* Reset Rejected List */}
          <div id="command-center-reset-rejected-list" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-reset-rejected-list')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-red-400/10 focus-within:border-white/15 focus-within:shadow-red-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-red-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-rose-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <RotateCcw className="w-7 h-7" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                    Reset Rejected List
                  </h2>
                  {renderFeatureFaqButton(
                    'command-center-reset-rejected-list',
                    'Reset Rejected List',
                  )}
                </div>
              </div>

              <SavingPill active={resetRejectedMutation.isPending} className="static" />
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Clears your Observatory rejected list so previously swiped-left suggestions can show up
              again.
            </p>

            {resetRejectedMutation.isError ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{(resetRejectedMutation.error as Error).message}</span>
              </div>
            ) : null}

            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={openRejectedList}
                  disabled={resetRejectedMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                >
                  <Info className="w-4 h-4" />
                  View rejected list
                </button>

                <button
                  type="button"
                  disabled={resetRejectedMutation.isPending}
                  onClick={openRejectedResetDialog}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset rejected list
                </button>
              </div>
            </div>
            </div>
          </div>

          {/* Reset Immaculate Taste - Confirm Dialog */}
          <AnimatePresence>
            {immaculateResetTarget && (
              <motion.div
                className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeImmaculateReset}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={stopClickPropagation}
                  className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-amber-500/10 overflow-hidden"
                >
                  <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Reset
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Immaculate Taste Collection
                        </h2>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-white/10 text-white/75 border border-white/10">
                            {immaculateResetTarget.mediaType === 'movie' ? 'Movie' : 'TV'}
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-white/10 text-white/75 border border-white/10">
                            {immaculateResetTarget.libraryTitle}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={closeImmaculateReset}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={resetImmaculateMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-200" />
                        <div className="min-w-0">
                          <div className="text-white/85 font-semibold">
                            This will delete the Plex collection and clear the dataset for this
                            library.
                          </div>
                          <div className="mt-2 text-xs text-white/55">
                            Dataset: {immaculateResetTarget.dataset.total} tracked (
                            {immaculateResetTarget.dataset.active} active,{' '}
                            {immaculateResetTarget.dataset.pending} pending) • Plex:{' '}
                            {immaculateResetTarget.plex.collectionRatingKey
                              ? typeof immaculateResetTarget.plex.itemCount === 'number'
                                ? `${immaculateResetTarget.plex.itemCount} items`
                                : 'Found'
                              : 'Not found'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {resetImmaculateMutation.isError ? (
                      <div className="mt-4 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(resetImmaculateMutation.error as Error).message}</span>
                      </div>
                    ) : null}

                    <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                      <button
                        type="button"
                        onClick={clearImmaculateReset}
                        className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetImmaculateMutation.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmImmaculateReset}
                        className="h-12 rounded-full px-6 bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetImmaculateMutation.isPending}
                      >
                        {resetImmaculateMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Resetting…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Reset
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reset Immaculate Taste (User) - Confirm Dialog */}
          <AnimatePresence>
            {immaculateUserResetTarget && (
              <motion.div
                className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeImmaculateUserReset}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={stopClickPropagation}
                  className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-amber-500/10 overflow-hidden"
                >
                  <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Reset
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Immaculate Taste (User)
                        </h2>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-white/10 text-white/75 border border-white/10">
                            {immaculateUserResetTarget.mediaType === 'movie' ? 'Movie' : 'TV'}
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 bg-white/10 text-white/75 border border-white/10">
                            {immaculateUserResetTarget.plexUserTitle}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={closeImmaculateUserReset}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={resetImmaculateUserMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-200" />
                        <div className="min-w-0">
                          <div className="text-white/85 font-semibold">
                            This will erase all{' '}
                            {immaculateUserResetTarget.mediaType === 'movie' ? 'movie' : 'TV'} collections
                            created by Immaculaterr for this user across every Plex library.
                          </div>
                          <div className="mt-2 text-xs text-white/55">
                            This also clears every tracked{' '}
                            {immaculateUserResetTarget.mediaType === 'movie' ? 'movie' : 'TV'} dataset
                            entry for this user profile. Items: {immaculateUserResetTarget.total}
                          </div>
                        </div>
                      </div>
                    </div>

                    {resetImmaculateUserMutation.isError ? (
                      <div className="mt-4 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(resetImmaculateUserMutation.error as Error).message}</span>
                      </div>
                    ) : null}

                    <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                      <button
                        type="button"
                        onClick={clearImmaculateUserReset}
                        className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetImmaculateUserMutation.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmImmaculateUserReset}
                        className="h-12 rounded-full px-6 bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetImmaculateUserMutation.isPending}
                      >
                        {resetImmaculateUserMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Resetting…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Reset
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reset Seerr Requests - Confirm Dialog */}
          <AnimatePresence>
            {seerrResetOpen && (
              <motion.div
                className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeSeerrReset}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={stopClickPropagation}
                  className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-cyan-500/10 overflow-hidden"
                >
                  <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Reset
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Seerr Requests
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={closeSeerrReset}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={resetSeerrMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-cyan-200" />
                        <div className="min-w-0">
                          <div className="text-white/85 font-semibold">
                            This will delete all requests in Seerr, regardless of status.
                          </div>
                          <div className="mt-2 text-xs text-white/55">
                            This action cannot be undone.
                          </div>
                        </div>
                      </div>
                    </div>

                    {resetSeerrMutation.isError ? (
                      <div className="mt-4 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(resetSeerrMutation.error as Error).message}</span>
                      </div>
                    ) : null}

                    <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                      <button
                        type="button"
                        onClick={clearSeerrReset}
                        className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetSeerrMutation.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmSeerrReset}
                        className="h-12 rounded-full px-6 bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetSeerrMutation.isPending}
                      >
                        {resetSeerrMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Resetting…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Reset
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reset Rejected List - Confirm Dialog */}
          <AnimatePresence>
            {rejectedResetOpen && (
              <motion.div
                className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeRejectedReset}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={stopClickPropagation}
                  className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-rose-500/10 overflow-hidden"
                >
                  <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Reset
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Rejected List
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={closeRejectedReset}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={resetRejectedMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                      <div className="flex items-start gap-3">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-rose-200" />
                        <div className="min-w-0">
                          <div className="text-white/85 font-semibold">
                            This will remove all rejected suggestions for your account.
                          </div>
                          <div className="mt-2 text-xs text-white/55">
                            After resetting, previously rejected cards can appear again in
                            Observatory.
                          </div>
                        </div>
                      </div>
                    </div>

                    {resetRejectedMutation.isError ? (
                      <div className="mt-4 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(resetRejectedMutation.error as Error).message}</span>
                      </div>
                    ) : null}

                    <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                      <button
                        type="button"
                        onClick={clearRejectedReset}
                        className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetRejectedMutation.isPending}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={confirmRejectedReset}
                        className="h-12 rounded-full px-6 bg-[#f43f5e] text-white font-bold shadow-[0_0_20px_rgba(244,63,94,0.25)] hover:shadow-[0_0_28px_rgba(244,63,94,0.35)] hover:scale-[1.02] transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                        disabled={resetRejectedMutation.isPending}
                      >
                        {resetRejectedMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Resetting…
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Reset
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* View Rejected List Modal */}
          <AnimatePresence>
            {rejectedListOpen && (
              <motion.div
                // Mobile: keep the modal within the visible area between the fixed top bar and bottom nav.
                // Desktop/tablet: center as usual.
                className="fixed inset-0 z-[100000] flex items-start sm:items-center justify-center px-4 pt-20 pb-28 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeRejectedList}
              >
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

                <motion.div
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 24, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={stopClickPropagation}
                  className="relative w-full sm:max-w-3xl max-h-[calc(100dvh-184px)] sm:max-h-[84vh] rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-rose-500/10 overflow-hidden flex flex-col"
                >
                  <div className="p-6 sm:p-7 border-b border-white/10">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                          Manage
                        </div>
                        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                          Rejected Suggestions
                        </h2>
                        <p className="mt-2 text-sm text-white/60">
                          Filter and remove items to let them appear in Observatory again.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={closeRejectedList}
                        className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                        aria-label="Close"
                        disabled={deleteRejectedMutation.isPending}
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Tabs + filters */}
                    <div className="mt-5 flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={selectRejectedMovieTab}
                          className={[
                            'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider border transition',
                            rejectedMediaTab === 'movie'
                              ? 'bg-[#facc15] text-black border-[#facc15]/30'
                              : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                          ].join(' ')}
                        >
                          <Film className="w-4 h-4" />
                          Movies
                        </button>
                        <button
                          type="button"
                          onClick={selectRejectedTvTab}
                          className={[
                            'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider border transition',
                            rejectedMediaTab === 'tv'
                              ? 'bg-[#facc15] text-black border-[#facc15]/30'
                              : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10',
                          ].join(' ')}
                        >
                          <Tv className="w-4 h-4" />
                          TV Shows
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(
                          [
                            ['all', 'All'],
                            ['immaculateTaste', 'Immaculate Taste'],
                            ['recentlyWatched', 'Recently Watched'],
                            ['changeOfTaste', 'Change of Taste'],
                          ] as const
                        ).map(([k, label]) => (
                          <button
                            key={k}
                            type="button"
                            data-rejected-kind={k}
                            onClick={handleRejectedKindClick}
                            className={[
                              'inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold border transition',
                              rejectedKind === k
                                ? 'bg-purple-500/20 text-purple-100 border-purple-500/30'
                                : 'bg-white/5 text-white/65 border-white/10 hover:bg-white/10',
                            ].join(' ')}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 sm:p-7">
                    {rejectedListQuery.isLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-white/50" />
                      </div>
                    ) : rejectedListQuery.isError ? (
                      <div className="flex items-start gap-2 text-sm text-red-200/90 py-4">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>Failed to load rejected list. Please try again.</span>
                      </div>
                    ) : filteredRejectedItems.length === 0 ? (
                      <div className="text-center py-12 text-white/50 text-sm">
                        No rejected suggestions found.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredRejectedItems.map((item) => {
                          const title =
                            item.mediaType === 'tv' && item.externalSource === 'tvdb'
                              ? item.externalName ?? 'Unknown show'
                              : item.externalName ??
                                (item.externalSource === 'tmdb'
                                  ? `TMDB ${item.externalId}`
                                  : `${item.externalSource.toUpperCase()}: ${item.externalId}`);
                          return (
                            <div
                              key={item.id}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span className="min-w-0 truncate rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-medium text-white/70">
                                    {title}
                                  </span>
                                  <span className="shrink-0 rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 font-medium text-purple-200">
                                    {kindLabel(item.collectionKind)}
                                  </span>
                                </div>
                                <div className="mt-1.5 text-xs text-white/40">
                                  {new Date(item.createdAt).toLocaleDateString()}
                                </div>
                              </div>
                              <button
                                type="button"
                                data-item-id={item.id}
                                onClick={handleRemoveRejectedItemClick}
                                disabled={deleteRejectedMutation.isPending}
                                className="shrink-0 w-9 h-9 rounded-xl border border-white/10 bg-white/5 text-white/60 hover:bg-rose-500/20 hover:border-rose-500/30 hover:text-rose-200 transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                                aria-label="Remove from rejected list"
                                title="Remove from rejected list"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="p-6 sm:p-7 border-t border-white/10">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-xs text-white/50">
                        {filteredRejectedItems.length} item{filteredRejectedItems.length === 1 ? '' : 's'}
                      </div>
                      <button
                        type="button"
                        onClick={dismissRejectedList}
                        className="h-10 rounded-full px-5 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98]"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <ConfirmDialog
            open={plexUserDeselectDialogOpen}
            onClose={closePlexUserDeselectDialog}
            onCancel={confirmPlexUserKeepCollectionsDialog}
            onConfirm={confirmPlexUserDeleteCollectionsDialog}
            title="Keep or Delete Deselected Users' Collections?"
            description={
              <div className="space-y-2">
                <div className="text-white/85 font-semibold">
                  You&apos;re unmonitoring one or more Plex users.
                </div>
                <div className="text-xs text-white/55">
                  Choose whether to keep their existing Immaculaterr collections or delete their
                  user data and remove those collections from Plex.
                </div>
              </div>
            }
            details={
              pendingPlexUserDeselectUsers.length ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-white/50">
                    Users being unmonitored
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pendingPlexUserDeselectUsers.map((user) => (
                      <span
                        key={user.id}
                        className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/80"
                      >
                        {user.plexAccountTitle}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null
            }
            confirmText="Save and delete collections"
            cancelText="Save and keep collections"
            variant="danger"
            confirming={savePlexMonitoringUsersMutation.isPending}
            error={
              savePlexMonitoringUsersMutation.isError
                ? (savePlexMonitoringUsersMutation.error as Error).message
                : null
            }
          />

          <ConfirmDialog
            open={plexLibraryDeselectDialogOpen}
            onClose={closePlexLibraryDeselectDialog}
            onCancel={confirmPlexLibraryKeepCollectionsDialog}
            onConfirm={confirmPlexLibraryDeleteCollectionsDialog}
            title="Keep or Delete Deselected Libraries' Collections?"
            description={
              <div className="space-y-2">
                <div className="text-white/85 font-semibold">
                  You&apos;re de-selecting one or more Plex libraries.
                </div>
                <div className="text-xs text-white/55">
                  Choose whether to keep existing curated collections or delete
                  Immaculaterr data and remove curated collections from Plex.
                </div>
              </div>
            }
            details={
              deselectedPlexLibraries.length ? (
                <div className="space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-white/50">
                    Libraries being deselected
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {deselectedPlexLibraries.map((lib) => (
                      <span
                        key={lib.key}
                        className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white/80"
                      >
                        {lib.title}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null
            }
            confirmText="Save and delete collections"
            cancelText="Save and keep collections"
            variant="danger"
            confirming={savePlexLibrarySelectionMutation.isPending}
            error={
              savePlexLibrarySelectionMutation.isError
                ? (savePlexLibrarySelectionMutation.error as Error).message
                : null
            }
          />

          <ConfirmDialog
            open={plexLibraryMinDialogOpen}
            onClose={closePlexLibraryMinDialog}
            onConfirm={closePlexLibraryMinDialog}
            title="At Least One Library Required"
            description="Immaculaterr requires at least one Plex movie or TV library to remain selected."
            confirmText="Got it"
            cancelText="Close"
            variant="primary"
          />

          <ConfirmDialog
            open={profileDeleteDialogOpen}
            onClose={closeProfileDeleteDialog}
            onConfirm={confirmProfileDeleteDialog}
            title={`Delete "${activeProfile?.name ?? 'Profile'}"?`}
            description={profileDeleteDialogDescription}
            details={profileDeleteDialogDetails}
            confirmText="Delete profile"
            cancelText="Keep profile"
            variant="danger"
            confirming={deleteImmaculateProfileMutation.isPending}
            error={
              deleteImmaculateProfileMutation.isError
                ? (deleteImmaculateProfileMutation.error as Error).message
                : null
            }
          />

          {/* Collection Posters */}
          <div id="command-center-collection-posters" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-collection-posters')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-amber-400/10 focus-within:border-white/15 focus-within:shadow-amber-400/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-amber-400/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-amber-200">
                  <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                    <Upload className="w-7 h-7" />
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                    Collection Posters
                  </h2>
                  {renderFeatureFaqButton(
                    'command-center-collection-posters',
                    'Collection Posters',
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!selectedCollectionArtworkUserId ? (
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    Select user
                  </span>
                ) : collectionArtworkManagedTargetsQuery.isLoading ? (
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                  >
                    Loading…
                  </span>
                ) : collectionArtworkManagedTargetsQuery.isError ? (
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}
                  >
                    Error
                  </span>
                ) : (
                  <span
                    className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-emerald-500/15 text-emerald-200 border-emerald-500/20`}
                  >
                    {collectionArtworkTargets.length} target
                    {collectionArtworkTargets.length === 1 ? '' : 's'}
                  </span>
                )}
                <SavingPill
                  active={
                    saveCollectionArtworkOverrideMutation.isPending ||
                    resetCollectionArtworkOverrideMutation.isPending
                  }
                  className="static"
                />
                {collectionArtworkFlowActive ? (
                  <button
                    type="button"
                    onClick={clearCollectionArtworkFlow}
                    disabled={
                      saveCollectionArtworkOverrideMutation.isPending ||
                      resetCollectionArtworkOverrideMutation.isPending
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/85 hover:bg-white/10 hover:text-white transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>

            <p className="mt-3 text-sm text-white/70 leading-relaxed">
              Override poster art per user and managed collection target. If no custom poster is
              set, refresh/recreate jobs use the built-in default artwork.
            </p>

            <div className="mt-5 space-y-5">
              <div className="space-y-2">
                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                  Plex user
                </div>
                <div className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 focus-within:ring-2 focus-within:ring-[#facc15]/40 focus-within:border-[#facc15]/40">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedCollectionArtworkUser ? (
                      <span className="inline-flex items-center rounded-full border border-sky-500/35 bg-sky-500/15 px-2 py-1 text-[11px] text-sky-100">
                        {selectedCollectionArtworkUser.plexAccountTitle}
                      </span>
                    ) : null}
                    <input
                      type="text"
                      value={collectionArtworkUserSearch}
                      onChange={(event) => setCollectionArtworkUserSearch(event.target.value)}
                      placeholder="Search and select a Plex user"
                      className="min-w-[12rem] flex-1 bg-transparent px-1 py-1 text-sm text-white placeholder-white/35 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {collectionArtworkUserSearchResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => selectCollectionArtworkUser(user.id)}
                      className={[
                        'inline-flex items-center rounded-full border px-2 py-1 text-[11px] transition',
                        selectedCollectionArtworkUserId === user.id
                          ? 'border-sky-500/35 bg-sky-500/15 text-sky-100'
                          : 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10',
                      ].join(' ')}
                    >
                      {user.plexAccountTitle}
                    </button>
                  ))}
                  {trimmedCollectionArtworkUserSearch &&
                  !collectionArtworkUserSearchResults.length ? (
                    <span className="text-[11px] text-white/45">
                      No users match "{collectionArtworkUserSearch.trim()}"
                    </span>
                  ) : null}
                </div>
              </div>

              {!selectedCollectionArtworkUserId ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
                  Select a user to load managed collection targets.
                </div>
              ) : collectionArtworkManagedTargetsQuery.isLoading ? (
                <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading managed collections…
                </div>
              ) : collectionArtworkManagedTargetsQuery.isError ? (
                <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200/90">
                  <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {(collectionArtworkManagedTargetsQuery.error as Error).message}
                  </span>
                </div>
              ) : !collectionArtworkTargets.length ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
                  No data on this user yet.
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                      Collection target
                    </div>
                    <Select
                      value={
                        selectedCollectionArtworkTarget
                          ? selectedCollectionArtworkTargetKey
                          : undefined
                      }
                      onValueChange={handleCollectionArtworkTargetChange}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select movie or TV collection target" />
                      </SelectTrigger>
                      <SelectContent>
                        {collectionArtworkTargets.map((target) => {
                          const key = getCollectionArtworkTargetKey(target);
                          const mediaLabel = target.mediaType === 'movie' ? 'Movie' : 'TV';
                          const sourceLabel =
                            target.source === 'immaculate'
                              ? 'Immaculate'
                              : 'Recently watched';
                          return (
                            <SelectItem key={key} value={key}>
                              <span className="inline-flex items-center gap-1.5">
                                {target.hasCustomPoster ? (
                                  <ImageIcon className="w-3.5 h-3.5 text-emerald-300" />
                                ) : null}
                                <span>
                                  {mediaLabel} • {target.collectionName} • {sourceLabel}
                                </span>
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedCollectionArtworkTarget ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/70">
                          {selectedCollectionArtworkTarget.mediaType === 'movie'
                            ? 'Movie'
                            : 'TV'}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/70">
                          {selectedCollectionArtworkTarget.source === 'immaculate'
                            ? 'Immaculate'
                            : 'Recently watched'}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/70">
                          {selectedCollectionArtworkTarget.datasetRows} rows
                        </span>
                        {selectedCollectionArtworkTarget.hasCustomPoster ? (
                          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-emerald-100">
                            Custom poster
                          </span>
                        ) : (
                          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-amber-100">
                            Default poster
                          </span>
                        )}
                      </div>

                      {selectedCollectionArtworkTarget.hasCustomPoster &&
                      selectedCollectionArtworkTarget.customPosterUpdatedAt ? (
                        <div className="text-xs text-white/50">
                          Custom poster updated:{' '}
                          {new Date(
                            selectedCollectionArtworkTarget.customPosterUpdatedAt,
                          ).toLocaleString()}
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <div className="block text-xs font-bold text-white/60 uppercase tracking-wider">
                          Upload poster
                        </div>
                        <input
                          ref={collectionArtworkFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleCollectionArtworkFileChange}
                          className="block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white file:mr-3 file:rounded-lg file:border-0 file:bg-[#facc15] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-black hover:file:brightness-95"
                        />
                        {collectionArtworkFile ? (
                          <div className="text-xs text-white/60">
                            Selected: {collectionArtworkFile.name} (
                            {formatFileSize(collectionArtworkFile.size)})
                          </div>
                        ) : (
                          <div className="text-xs text-white/45">
                            PNG, JPG, or WEBP. Max 5 MB.
                          </div>
                        )}
                      </div>

                      {(saveCollectionArtworkOverrideMutation.isError ||
                        resetCollectionArtworkOverrideMutation.isError) && (
                        <div className="flex items-start gap-2 text-sm text-red-200/90">
                          <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>
                            {(saveCollectionArtworkOverrideMutation.error as Error)?.message ||
                              (resetCollectionArtworkOverrideMutation.error as Error)?.message}
                          </span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        {selectedCollectionArtworkTarget.hasCustomPoster ? (
                          <button
                            type="button"
                            onClick={openCollectionArtworkPreview}
                            className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/15 transition active:scale-95"
                          >
                            <ImageIcon className="w-4 h-4" />
                            View custom poster
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={saveCollectionArtworkOverride}
                          disabled={
                            saveCollectionArtworkOverrideMutation.isPending ||
                            resetCollectionArtworkOverrideMutation.isPending ||
                            !collectionArtworkFile
                          }
                          className="inline-flex items-center gap-2 rounded-xl bg-[#facc15] px-4 py-2 text-sm font-bold text-black shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02] transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                        >
                          {saveCollectionArtworkOverrideMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Saving…
                            </>
                          ) : (
                            <>
                              <Upload className="w-4 h-4" />
                              Save poster
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={resetCollectionArtworkOverride}
                          disabled={
                            saveCollectionArtworkOverrideMutation.isPending ||
                            resetCollectionArtworkOverrideMutation.isPending ||
                            !selectedCollectionArtworkTarget.hasCustomPoster
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                        >
                          {resetCollectionArtworkOverrideMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Resetting…
                            </>
                          ) : (
                            <>
                              <RotateCcw className="w-4 h-4" />
                              Reset to default
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={clearCollectionArtworkFlow}
                          disabled={
                            saveCollectionArtworkOverrideMutation.isPending ||
                            resetCollectionArtworkOverrideMutation.isPending
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/75 hover:bg-white/10 hover:text-white transition disabled:opacity-60 disabled:cursor-not-allowed active:scale-95"
                        >
                          <X className="w-4 h-4" />
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
                      Select a collection target to upload or reset poster artwork.
                    </div>
                  )}
                </div>
              )}
            </div>
            </div>
          </div>

          <AnimatePresence>
            {collectionArtworkPreviewOpen ? (
              <motion.div
                className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeCollectionArtworkPreview}
              >
                <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  onClick={(event) => event.stopPropagation()}
                  className="relative w-full max-w-xl rounded-[28px] border border-white/15 bg-[#0b0c0f]/90 p-5 sm:p-6 shadow-2xl shadow-emerald-500/10 backdrop-blur-2xl"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-200/80">
                        Collection Poster
                      </div>
                      <h3 className="mt-1 text-xl font-semibold text-white truncate">
                        {selectedCollectionArtworkTarget?.collectionName ?? 'Custom poster'}
                      </h3>
                      <div className="mt-1 text-xs text-white/55">
                        {selectedCollectionArtworkTarget?.mediaType === 'movie' ? 'Movie' : 'TV'}{' '}
                        •{' '}
                        {selectedCollectionArtworkTarget?.source === 'immaculate'
                          ? 'Immaculate'
                          : 'Recently watched'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={closeCollectionArtworkPreview}
                      className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white transition"
                      aria-label="Close poster preview"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-2">
                    {selectedCollectionArtworkPreviewUrl && !collectionArtworkPreviewFailed ? (
                      <img
                        src={selectedCollectionArtworkPreviewUrl}
                        alt={`${selectedCollectionArtworkTarget?.collectionName ?? 'Collection'} poster`}
                        onError={() => setCollectionArtworkPreviewFailed(true)}
                        className="mx-auto w-full max-w-[320px] rounded-xl border border-white/10 bg-black/40 object-contain shadow-lg"
                      />
                    ) : (
                      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-6 text-sm text-red-200/90">
                        Couldn&apos;t load this custom poster preview.
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={closeCollectionArtworkPreview}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/10 hover:text-white transition"
                    >
                      Close
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          {/* Radarr */}
          <div id="command-center-radarr" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-radarr')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-purple-500/10 focus-within:border-white/15 focus-within:shadow-purple-500/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-purple-500/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-[#facc15]">
                    <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                      <RadarrLogo className="w-7 h-7" />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                      Radarr
                    </h2>
                    {renderFeatureFaqButton('command-center-radarr', 'Radarr')}
                  </div>
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    {settingsQuery.isLoading ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                      >
                        Checking…
                      </span>
                    ) : settingsQuery.isError ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}
                      >
                        Error
                      </span>
                    ) : radarrEnabled ? (
                      null
                    ) : (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-yellow-400/10 text-yellow-200 border-yellow-400/20`}
                      >
                        Not set up
                      </span>
                    )}

                    <SavingPill
                      active={
                        saveRadarrDefaultsMutation.isPending ||
                        saveRadarrInstanceDefaultsMutation.isPending
                      }
                      className="static shrink-0"
                    />
                  </div>
                </div>

                {settingsQuery.isError ? (
                  <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                    <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Couldn’t load settings to check Radarr status. Please open{' '}
                      <Link
                        to="/vault#vault-radarr"
                        className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                      >
                        Vault
                      </Link>{' '}
                      and verify your Radarr configuration.
                    </span>
                </div>
                ) : radarrEnabled ? (
                  <>
                    <p className="mt-3 text-sm text-white/70 leading-relaxed">
                      Choose the defaults used when this app sends missing movies to Radarr. Manage
                      the URL and API key in{' '}
                      <Link
                        to="/vault#vault-radarr"
                        className="text-white underline underline-offset-4 hover:text-white/90 transition-colors inline-flex items-center gap-1"
                      >
                        Vault <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                      .
                    </p>

                    <div className="mt-5">
                      <div
                        className={
                          showRadarrStackedDefaults
                            ? 'rounded-2xl border border-white/10 bg-white/5 p-4'
                            : ''
                        }
                      >
                        {showRadarrStackedDefaults ? (
                          <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-white/55">
                            Primary
                          </div>
                        ) : null}
                        {radarrOptionsQuery.isLoading ? (
                          <div className="flex items-center gap-3 text-white/70 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading Radarr options…
                          </div>
                        ) : radarrOptionsQuery.isError ? (
                          <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>
                              Couldn’t load Radarr folders/profiles/tags. Verify your Radarr
                              connection in{' '}
                              <Link
                                to="/vault#vault-radarr"
                                className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                              >
                                Vault
                              </Link>
                              .
                            </span>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                            <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Root folder
                            </div>
                          <Select
                            value={draftRootFolderPath || effectiveDefaults.rootFolderPath}
                            onValueChange={handleRadarrRootFolderChange}
                            disabled={
                              saveRadarrDefaultsMutation.isPending ||
                              !radarrOptionsQuery.data?.rootFolders.length
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select root folder" />
                            </SelectTrigger>
                            <SelectContent>
                              {(radarrOptionsQuery.data?.rootFolders ?? []).map((rf) => (
                                <SelectItem key={rf.id} value={rf.path}>
                                  {rf.path}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
              </div>

                  <div>
                            <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Quality profile
                            </div>
                          <Select
                            value={String(
                              draftQualityProfileId || effectiveDefaults.qualityProfileId,
                            )}
                            onValueChange={handleRadarrQualityProfileChange}
                            disabled={
                              saveRadarrDefaultsMutation.isPending ||
                              !radarrOptionsQuery.data?.qualityProfiles.length
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select quality profile" />
                            </SelectTrigger>
                            <SelectContent>
                              {(radarrOptionsQuery.data?.qualityProfiles ?? []).map((qp) => (
                                <SelectItem key={qp.id} value={String(qp.id)}>
                                  {qp.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                </div>

                        <div>
                            <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Tag (optional)
                            </div>
                          <Select
                            value={draftTagId !== null ? String(draftTagId) : 'none'}
                            onValueChange={handleRadarrTagChange}
                            disabled={saveRadarrDefaultsMutation.isPending}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="No tag" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tag</SelectItem>
                              {(radarrOptionsQuery.data?.tags ?? []).map((t) => (
                                <SelectItem key={t.id} value={String(t.id)}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {saveRadarrDefaultsMutation.isError ? (
                      <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(saveRadarrDefaultsMutation.error as Error).message}</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-white/70 leading-relaxed">
                    Radarr isn’t set up yet. Please enable and configure{' '}
                    <Link
                      to="/vault#vault-radarr"
                      className="text-white underline underline-offset-4 hover:text-white/90 transition-colors inline-flex items-center gap-1"
                    >
                      Radarr in Vault <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                    .
                  </p>
                )}
                {showRadarrStackedDefaults ? (
                  <div className="mt-5 space-y-4">
                    {enabledSecondaryRadarrInstances.map((instance, index) => {
                      const optionsQuery = radarrSecondaryOptionsQueries[index];
                      const rootFolders = optionsQuery?.data?.rootFolders ?? [];
                      const qualityProfiles = optionsQuery?.data?.qualityProfiles ?? [];
                      const tags = optionsQuery?.data?.tags ?? [];
                      const effectiveRootFolderPath =
                        (instance.rootFolderPath &&
                          rootFolders.some((folder) => folder.path === instance.rootFolderPath) &&
                          instance.rootFolderPath) ||
                        (rootFolders[0]?.path ?? '');
                      const effectiveQualityProfileId = (() => {
                        if (
                          instance.qualityProfileId &&
                          qualityProfiles.some(
                            (profile) => profile.id === instance.qualityProfileId,
                          )
                        ) {
                          return instance.qualityProfileId;
                        }
                        if (qualityProfiles.some((profile) => profile.id === 1)) return 1;
                        return qualityProfiles[0]?.id ?? 1;
                      })();
                      const effectiveTagId =
                        instance.tagId && tags.some((tag) => tag.id === instance.tagId)
                          ? instance.tagId
                          : null;

                      return (
                        <div
                          key={instance.id}
                          className="rounded-2xl border border-white/10 bg-white/5 p-4"
                        >
                          <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-white/55">
                            {instance.name}
                          </div>
                          {optionsQuery?.isLoading ? (
                            <div className="flex items-center gap-3 text-white/70 text-sm">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading {instance.name} options…
                            </div>
                          ) : optionsQuery?.isError ? (
                            <div className="flex items-start gap-2 text-sm text-red-200/90">
                              <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                              <span>
                                Couldn’t load folders/profiles/tags for {instance.name}. Check this
                                server in{' '}
                                <Link
                                  to="/vault#vault-radarr"
                                  className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                                >
                                  Vault
                                </Link>
                                .
                              </span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Root folder
                                </div>
                                <Select
                                  value={effectiveRootFolderPath}
                                  onValueChange={(next) =>
                                    handleRadarrSecondaryRootFolderChange(instance.id, next)
                                  }
                                  disabled={
                                    saveRadarrInstanceDefaultsMutation.isPending ||
                                    !rootFolders.length
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select root folder" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {rootFolders.map((folder) => (
                                      <SelectItem key={folder.id} value={folder.path}>
                                        {folder.path}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Quality profile
                                </div>
                                <Select
                                  value={String(effectiveQualityProfileId)}
                                  onValueChange={(raw) =>
                                    handleRadarrSecondaryQualityProfileChange(instance.id, raw)
                                  }
                                  disabled={
                                    saveRadarrInstanceDefaultsMutation.isPending ||
                                    !qualityProfiles.length
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select quality profile" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {qualityProfiles.map((profile) => (
                                      <SelectItem key={profile.id} value={String(profile.id)}>
                                        {profile.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Tag (optional)
                                </div>
                                <Select
                                  value={effectiveTagId !== null ? String(effectiveTagId) : 'none'}
                                  onValueChange={(raw) =>
                                    handleRadarrSecondaryTagChange(instance.id, raw)
                                  }
                                  disabled={saveRadarrInstanceDefaultsMutation.isPending}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="No tag" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No tag</SelectItem>
                                    {tags.map((tag) => (
                                      <SelectItem key={tag.id} value={String(tag.id)}>
                                        {tag.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                  </div>
                </div>
            </div>
          </div>

          {/* Sonarr */}
          <div id="command-center-sonarr" className="relative scroll-mt-24">
            {renderFeatureCardFlash('command-center-sonarr')}
            <div className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl transition-all duration-300 hover:bg-[#0b0c0f]/75 hover:border-white/15 hover:shadow-2xl hover:shadow-purple-500/10 focus-within:border-white/15 focus-within:shadow-purple-500/10 active:bg-[#0b0c0f]/75 active:border-white/15 active:shadow-2xl active:shadow-purple-500/15 before:content-[''] before:absolute before:top-0 before:right-0 before:w-[26rem] before:h-[26rem] before:bg-gradient-to-br before:from-white/5 before:to-transparent before:opacity-0 hover:before:opacity-100 focus-within:before:opacity-100 active:before:opacity-100 before:transition-opacity before:duration-500 before:blur-3xl before:rounded-full before:pointer-events-none before:-z-10">
            <div className="flex items-start sm:items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-sky-400">
                    <span className="transition-[filter] duration-300 will-change-[filter] group-hover:drop-shadow-[0_0_18px_currentColor] group-focus-within:drop-shadow-[0_0_18px_currentColor] group-active:drop-shadow-[0_0_18px_currentColor]">
                      <SonarrLogo className="w-7 h-7" />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold text-white min-w-0 leading-tight">
                      Sonarr
                    </h2>
                    {renderFeatureFaqButton('command-center-sonarr', 'Sonarr')}
                  </div>
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    {settingsQuery.isLoading ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-white/10 text-white/70 border-white/10`}
                      >
                        Checking…
                      </span>
                    ) : settingsQuery.isError ? (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-red-500/15 text-red-200 border-red-500/20`}
                      >
                        Error
                      </span>
                    ) : sonarrEnabled ? (
                      null
                    ) : (
                      <span
                        className={`${APP_HEADER_STATUS_PILL_BASE_CLASS} bg-yellow-400/10 text-yellow-200 border-yellow-400/20`}
                      >
                        Not set up
                      </span>
                    )}

                    <SavingPill
                      active={
                        saveSonarrDefaultsMutation.isPending ||
                        saveSonarrInstanceDefaultsMutation.isPending
                      }
                      className="static shrink-0"
                    />
                  </div>
                </div>

                {settingsQuery.isError ? (
                  <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                    <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Couldn’t load settings to check Sonarr status. Please open{' '}
                      <Link
                        to="/vault#vault-sonarr"
                        className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                      >
                        Vault
                      </Link>{' '}
                      and verify your Sonarr configuration.
                    </span>
                  </div>
                ) : sonarrEnabled ? (
                  <>
                    <p className="mt-3 text-sm text-white/70 leading-relaxed">
                      Choose defaults for Sonarr actions that create or manage series. Manage the
                      URL and API key in{' '}
                      <Link
                        to="/vault#vault-sonarr"
                        className="text-white underline underline-offset-4 hover:text-white/90 transition-colors inline-flex items-center gap-1"
                      >
                        Vault <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                      .
                    </p>

                    <div className="mt-5">
                      <div
                        className={
                          showSonarrStackedDefaults
                            ? 'rounded-2xl border border-white/10 bg-white/5 p-4'
                            : ''
                        }
                      >
                        {showSonarrStackedDefaults ? (
                          <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-white/55">
                            Primary
                          </div>
                        ) : null}
                        {sonarrOptionsQuery.isLoading ? (
                          <div className="flex items-center gap-3 text-white/70 text-sm">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Loading Sonarr options…
                          </div>
                        ) : sonarrOptionsQuery.isError ? (
                          <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>
                              Couldn’t load Sonarr folders/profiles/tags. Verify your Sonarr
                              connection in{' '}
                              <Link
                                to="/vault#vault-sonarr"
                                className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                              >
                                Vault
                              </Link>
                              .
                            </span>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Root folder
                            </div>
                          <Select
                            value={
                              sonarrDraftRootFolderPath || sonarrEffectiveDefaults.rootFolderPath
                            }
                            onValueChange={handleSonarrRootFolderChange}
                            disabled={
                              saveSonarrDefaultsMutation.isPending ||
                              !sonarrOptionsQuery.data?.rootFolders.length
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select root folder" />
                            </SelectTrigger>
                            <SelectContent>
                              {(sonarrOptionsQuery.data?.rootFolders ?? []).map((rf) => (
                                <SelectItem key={rf.id} value={rf.path}>
                                  {rf.path}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                </div>

                        <div>
                            <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Quality profile
                            </div>
                          <Select
                            value={String(
                              sonarrDraftQualityProfileId ||
                                sonarrEffectiveDefaults.qualityProfileId,
                            )}
                            onValueChange={handleSonarrQualityProfileChange}
                            disabled={
                              saveSonarrDefaultsMutation.isPending ||
                              !sonarrOptionsQuery.data?.qualityProfiles.length
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select quality profile" />
                            </SelectTrigger>
                            <SelectContent>
                              {(sonarrOptionsQuery.data?.qualityProfiles ?? []).map((qp) => (
                                <SelectItem key={qp.id} value={String(qp.id)}>
                                  {qp.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                </div>

                        <div>
                            <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                              Tag (optional)
                            </div>
                          <Select
                            value={sonarrDraftTagId !== null ? String(sonarrDraftTagId) : 'none'}
                            onValueChange={handleSonarrTagChange}
                            disabled={saveSonarrDefaultsMutation.isPending}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="No tag" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No tag</SelectItem>
                              {(sonarrOptionsQuery.data?.tags ?? []).map((t) => (
                                <SelectItem key={t.id} value={String(t.id)}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {saveSonarrDefaultsMutation.isError ? (
                      <div className="mt-3 flex items-start gap-2 text-sm text-red-200/90">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                        <span>{(saveSonarrDefaultsMutation.error as Error).message}</span>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-white/70 leading-relaxed">
                    Sonarr isn’t set up yet. Please enable and configure{' '}
                    <Link
                      to="/vault#vault-sonarr"
                      className="text-white underline underline-offset-4 hover:text-white/90 transition-colors inline-flex items-center gap-1"
                    >
                      Sonarr in Vault <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                    .
                  </p>
                )}
                {showSonarrStackedDefaults ? (
                  <div className="mt-5 space-y-4">
                    {enabledSecondarySonarrInstances.map((instance, index) => {
                      const optionsQuery = sonarrSecondaryOptionsQueries[index];
                      const rootFolders = optionsQuery?.data?.rootFolders ?? [];
                      const qualityProfiles = optionsQuery?.data?.qualityProfiles ?? [];
                      const tags = optionsQuery?.data?.tags ?? [];
                      const effectiveRootFolderPath =
                        (instance.rootFolderPath &&
                          rootFolders.some((folder) => folder.path === instance.rootFolderPath) &&
                          instance.rootFolderPath) ||
                        (rootFolders[0]?.path ?? '');
                      const effectiveQualityProfileId = (() => {
                        if (
                          instance.qualityProfileId &&
                          qualityProfiles.some(
                            (profile) => profile.id === instance.qualityProfileId,
                          )
                        ) {
                          return instance.qualityProfileId;
                        }
                        if (qualityProfiles.some((profile) => profile.id === 1)) return 1;
                        return qualityProfiles[0]?.id ?? 1;
                      })();
                      const effectiveTagId =
                        instance.tagId && tags.some((tag) => tag.id === instance.tagId)
                          ? instance.tagId
                          : null;

                      return (
                        <div
                          key={instance.id}
                          className="rounded-2xl border border-white/10 bg-white/5 p-4"
                        >
                          <div className="mb-3 text-[11px] font-bold uppercase tracking-wider text-white/55">
                            {instance.name}
                          </div>
                          {optionsQuery?.isLoading ? (
                            <div className="flex items-center gap-3 text-white/70 text-sm">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Loading {instance.name} options…
                            </div>
                          ) : optionsQuery?.isError ? (
                            <div className="flex items-start gap-2 text-sm text-red-200/90">
                              <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                              <span>
                                Couldn’t load folders/profiles/tags for {instance.name}. Check this
                                server in{' '}
                                <Link
                                  to="/vault#vault-sonarr"
                                  className="text-white underline underline-offset-4 hover:text-white/90 transition-colors"
                                >
                                  Vault
                                </Link>
                                .
                              </span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Root folder
                                </div>
                                <Select
                                  value={effectiveRootFolderPath}
                                  onValueChange={(next) =>
                                    handleSonarrSecondaryRootFolderChange(instance.id, next)
                                  }
                                  disabled={
                                    saveSonarrInstanceDefaultsMutation.isPending ||
                                    !rootFolders.length
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select root folder" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {rootFolders.map((folder) => (
                                      <SelectItem key={folder.id} value={folder.path}>
                                        {folder.path}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Quality profile
                                </div>
                                <Select
                                  value={String(effectiveQualityProfileId)}
                                  onValueChange={(raw) =>
                                    handleSonarrSecondaryQualityProfileChange(instance.id, raw)
                                  }
                                  disabled={
                                    saveSonarrInstanceDefaultsMutation.isPending ||
                                    !qualityProfiles.length
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select quality profile" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {qualityProfiles.map((profile) => (
                                      <SelectItem key={profile.id} value={String(profile.id)}>
                                        {profile.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <div className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-2">
                                  Tag (optional)
                                </div>
                                <Select
                                  value={effectiveTagId !== null ? String(effectiveTagId) : 'none'}
                                  onValueChange={(raw) =>
                                    handleSonarrSecondaryTagChange(instance.id, raw)
                                  }
                                  disabled={saveSonarrInstanceDefaultsMutation.isPending}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="No tag" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="none">No tag</SelectItem>
                                    {tags.map((tag) => (
                                      <SelectItem key={tag.id} value={String(tag.id)}>
                                        {tag.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
            </div>
          </div>
        </div>
      }
      showCards={false}
    />
  );
}
