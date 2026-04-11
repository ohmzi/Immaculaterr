import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, FileUp, Loader2, CheckCircle2 } from 'lucide-react';
import { uploadNetflixCsv, type ImportUploadResponse } from '@/api/import';
import { ApiError } from '@/api/http';

type UploadState = 'idle' | 'dragging' | 'uploading' | 'success' | 'error';

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<body')
  );
}

function getUploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 504) {
      return 'The server timed out while starting the import. Please try again once the app is responsive.';
    }
    if (typeof error.body === 'string' && looksLikeHtml(error.body)) {
      return `The import failed with HTTP ${error.status}. Please try again.`;
    }
  }

  return error instanceof Error ? error.message : 'Upload failed';
}

export function NetflixImportUpload({
  onSuccess,
  compact = false,
}: {
  onSuccess?: (result: ImportUploadResponse) => void;
  compact?: boolean;
}) {
  const [state, setState] = useState<UploadState>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportUploadResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadNetflixCsv,
    onSuccess: (data) => {
      setState('success');
      setResult(data);
      onSuccess?.(data);
    },
    onError: (err) => {
      setState('error');
      setErrorMessage(getUploadErrorMessage(err));
    },
  });

  const validateAndSetFile = useCallback((file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setState('error');
      setErrorMessage('Only .csv files are accepted');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setState('error');
      setErrorMessage('File exceeds the 5 MB limit');
      return;
    }
    setSelectedFile(file);
    setErrorMessage(null);
    setState('idle');
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setState('dragging');
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setState((prev) => (prev === 'dragging' ? 'idle' : prev));
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setState('idle');
      const file = e.dataTransfer.files[0] ?? null;
      validateAndSetFile(file);
    },
    [validateAndSetFile],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      validateAndSetFile(file);
    },
    [validateAndSetFile],
  );

  const handleUpload = useCallback(() => {
    if (!selectedFile) return;
    setState('uploading');
    setErrorMessage(null);
    uploadMutation.mutate(selectedFile);
  }, [selectedFile, uploadMutation]);

  if (state === 'success' && result) {
    const { newlyInserted, alreadyImported, readyToSeed, alreadyProcessed } =
      result;
    const allDone = !result.jobId && readyToSeed === 0 && newlyInserted === 0;

    const headline = (() => {
      if (newlyInserted > 0 && alreadyImported > 0) {
        return `Found ${result.totalUnique} unique titles (${newlyInserted} new, ${alreadyImported} already imported)`;
      }
      if (newlyInserted > 0) {
        return `Found ${result.totalUnique} unique titles`;
      }
      if (readyToSeed > 0) {
        return `All ${result.totalUnique} titles already known — ${readyToSeed} will be used as seeds`;
      }
      if (alreadyProcessed > 0) {
        return `All ${result.totalUnique} titles have been imported and processed`;
      }
      return `Found ${result.totalUnique} unique titles — all already imported`;
    })();

    const subtitle = (() => {
      if (allDone) return 'Nothing new to process.';
      if (result.jobId && readyToSeed > 0 && newlyInserted === 0) {
        return `Processing next batch of seeds. Monitor progress in Rewind.`;
      }
      if (result.jobId) {
        return 'Analysis is in progress. You can monitor progress in Rewind.';
      }
      return null;
    })();

    return (
      <div className="space-y-4">
        <div
          className={`flex items-center gap-3 rounded-xl border p-4 ${allDone ? 'border-zinc-500/20 bg-zinc-500/5' : 'border-emerald-500/20 bg-emerald-500/5'}`}
        >
          <CheckCircle2
            className={`h-6 w-6 shrink-0 ${allDone ? 'text-zinc-400' : 'text-emerald-400'}`}
          />
          <div>
            <p
              className={`font-medium ${allDone ? 'text-zinc-300' : 'text-emerald-300'}`}
            >
              {headline}
            </p>
            {subtitle && (
              <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
            )}
          </div>
        </div>

        {result.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="space-y-1">
                {result.warnings.map((w, i) => (
                  <p key={i} className="text-sm text-amber-300">
                    {w}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed transition-all ${
          compact ? 'p-6' : 'p-10'
        } ${
          state === 'dragging'
            ? 'border-red-400 bg-red-500/5'
            : state === 'uploading'
              ? 'pointer-events-none border-zinc-600 bg-zinc-800/30'
              : selectedFile
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
        />

        {state === 'uploading' ? (
          <Loader2 className="h-10 w-10 animate-spin text-zinc-400" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 ring-1 ring-red-500/20">
            <FileUp className="h-7 w-7 text-red-400" />
          </div>
        )}

        <p className="mt-4 text-sm font-medium text-zinc-200">
          {state === 'uploading'
            ? 'Uploading...'
            : selectedFile
              ? selectedFile.name
              : 'Drop your Netflix CSV here or click to browse'}
        </p>
        {!selectedFile && state !== 'uploading' && (
          <p className="mt-1 text-xs text-zinc-500">
            One .csv file at a time, up to 5 MB
          </p>
        )}
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-300">{errorMessage}</p>
        </div>
      )}

      {selectedFile && state !== 'uploading' && (
        <button
          type="button"
          onClick={handleUpload}
          className="w-full rounded-xl bg-yellow-500 py-3 text-sm font-semibold text-black transition-colors hover:bg-yellow-400 disabled:opacity-50"
        >
          Start Import
        </button>
      )}
    </div>
  );
}
