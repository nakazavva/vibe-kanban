import type {
  ExecutionProcess,
  ExecutorAction,
  ExecutorProfileId,
} from 'shared/types';

const extractProfileFromAction = (
  action: ExecutorAction | null
): ExecutorProfileId | null => {
  let current: ExecutorAction | null = action;

  while (current) {
    const { typ } = current;

    switch (typ.type) {
      case 'CodingAgentInitialRequest':
      case 'CodingAgentFollowUpRequest':
        return typ.executor_profile_id;
      case 'ScriptRequest':
        current = current.next_action ?? null;
        continue;
      default:
        return null;
    }
  }

  return null;
};

export const latestExecutorProfileId = (
  processes: ExecutionProcess[]
): ExecutorProfileId | null => {
  if (!processes?.length) {
    return null;
  }

  for (let i = processes.length - 1; i >= 0; i -= 1) {
    const profile = extractProfileFromAction(
      processes[i]?.executor_action ?? null
    );
    if (profile) {
      return profile;
    }
  }

  return null;
};
