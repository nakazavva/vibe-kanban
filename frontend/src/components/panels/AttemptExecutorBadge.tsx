import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskAttempt, ExecutorProfileId } from 'shared/types';
import { ProfileVariantBadge } from '@/components/common/ProfileVariantBadge';
import { useExecutionProcessesContext } from '@/contexts/ExecutionProcessesContext';
import { latestExecutorProfileId } from '@/lib/executor-profiles';
import { cn } from '@/lib/utils';

interface AttemptExecutorBadgeProps {
  attempt?: TaskAttempt | null;
  className?: string;
}

export function AttemptExecutorBadge({
  attempt,
  className,
}: AttemptExecutorBadgeProps) {
  const { t } = useTranslation('tasks');
  const { executionProcessesAll } = useExecutionProcessesContext();

  const profileVariant = useMemo<ExecutorProfileId | null>(() => {
    const fromProcesses = latestExecutorProfileId(executionProcessesAll);

    if (fromProcesses) {
      return fromProcesses;
    }

    if (attempt?.executor) {
      return {
        executor: attempt.executor,
        variant: null,
      };
    }

    return null;
  }, [attempt?.executor, executionProcessesAll]);

  if (!profileVariant) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-xs text-muted-foreground',
        className
      )}
    >
      <span>{t('processes.agent')}</span>
      <ProfileVariantBadge profileVariant={profileVariant} />
    </div>
  );
}
