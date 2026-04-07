import { apiPath } from '@/api/constants';
import { ApiError, readApiError } from '@/api/http';

export type ImportUploadResponse = {
  totalRawRows: number;
  totalUnique: number;
  newlyInserted: number;
  alreadyImported: number;
  pendingClassification: number;
  readyToSeed: number;
  alreadyProcessed: number;
  jobId: string | null;
  warnings: string[];
};

export type ImportStatusResponse = {
  total: number;
  pending: number;
  matched: number;
  processed: number;
  unmatched: number;
};

export async function uploadNetflixCsv(
  file: File,
): Promise<ImportUploadResponse> {
  const form = new FormData();
  form.set('file', file);

  const response = await fetch(apiPath('/import/netflix'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: form,
  });
  if (!response.ok) {
    const { message, body } = await readApiError(response);
    throw new ApiError(response.status, message, body);
  }
  return (await response.json()) as ImportUploadResponse;
}

export async function getImportStatus(): Promise<ImportStatusResponse> {
  const response = await fetch(apiPath('/import/status'), {
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!response.ok) {
    const { message, body } = await readApiError(response);
    throw new ApiError(response.status, message, body);
  }
  return (await response.json()) as ImportStatusResponse;
}
