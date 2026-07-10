import { useEffect } from 'react';

/**
 * Warns before the tab closes or reloads while there are unsaved edits.
 * (In-app route changes are not intercepted; pair this with a visible
 * "unsaved changes" indicator near the save button.)
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
