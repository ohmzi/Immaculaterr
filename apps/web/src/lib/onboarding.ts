const ONBOARDING_STORAGE_KEY = 'tcp_onboarding_v1';

export type OnboardingStored = {
  completed: boolean;
  completedAt?: string;
  rememberSecrets?: boolean;
  values?: Record<string, unknown>;
  results?: Record<string, unknown>;
};

export function loadOnboarding(): OnboardingStored | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    return {
      completed: Boolean(obj.completed),
      completedAt: typeof obj.completedAt === 'string' ? obj.completedAt : undefined,
      rememberSecrets: Boolean(obj.rememberSecrets),
      values: typeof obj.values === 'object' && obj.values ? (obj.values as Record<string, unknown>) : undefined,
      results:
        typeof obj.results === 'object' && obj.results ? (obj.results as Record<string, unknown>) : undefined,
    };
  } catch {
    return null;
  }
}

export function saveOnboarding(value: OnboardingStored) {
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(value));
}

export function clearOnboarding() {
  localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}


