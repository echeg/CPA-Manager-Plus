import { useEffect, useState } from 'react';
import { apiClient } from '@/features/personal-quota-support/services/api/client';
import {
  subscriptionRoutingApi,
  type SubscriptionActivity,
} from '@/features/personal-quota-support/services/api/subscriptionRouting';
import type { ActivityState } from '../routingModel';

/** Polls the server's latest credential selections every 10 seconds while connected. */
export function useSubscriptionActivity(disconnected: boolean) {
  const [activity, setActivity] = useState<SubscriptionActivity[]>([]);
  const [activityState, setActivityState] = useState<ActivityState>('loading');

  useEffect(() => {
    if (disconnected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () => active && revision === apiClient.getConnectionRevision();
    const refresh = async () => {
      try {
        const next = await subscriptionRoutingApi.activity();
        if (!isCurrent()) return;
        setActivity(next);
        setActivityState('ready');
      } catch {
        if (!isCurrent()) return;
        setActivity([]);
        setActivityState('error');
      } finally {
        if (isCurrent()) timer = setTimeout(() => void refresh(), 10000);
      }
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [disconnected]);

  return { activity, activityState };
}
