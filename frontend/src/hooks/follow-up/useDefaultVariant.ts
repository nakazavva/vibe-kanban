import { useEffect, useMemo, useState } from 'react';
import type { ExecutorConfig, ExecutionProcess } from 'shared/types';
import { latestExecutorProfileId } from '@/lib/executor-profiles';

type Args = {
  processes: ExecutionProcess[];
  profiles?: Record<string, ExecutorConfig> | null;
};

export function useDefaultVariant({ processes, profiles }: Args) {
  const latestProfileId = useMemo(
    () => latestExecutorProfileId(processes),
    [processes]
  );

  const defaultFollowUpVariant = latestProfileId?.variant ?? null;

  const [selectedVariant, setSelectedVariant] = useState<string | null>(
    defaultFollowUpVariant
  );
  useEffect(
    () => setSelectedVariant(defaultFollowUpVariant),
    [defaultFollowUpVariant]
  );

  const currentProfile = useMemo(() => {
    if (!latestProfileId) return null;
    return profiles?.[latestProfileId.executor] ?? null;
  }, [latestProfileId, profiles]);

  return { selectedVariant, setSelectedVariant, currentProfile } as const;
}
