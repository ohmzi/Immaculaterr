import { useQuery } from '@tanstack/react-query';

import { getHealth } from '@/api/health';

export function useHealthQuery() {
  return useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
}


