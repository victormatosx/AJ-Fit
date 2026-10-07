import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth } from '../lib/firebase';
import { functions } from '../lib/firebaseFunctions';
import { createCampaignOpenQueue } from '../services/campaignOpenQueue';
import {
  consumeDeepLinkIntent as consumePendingIntent,
  enqueueDeepLinkIntent,
  parseDeepLink,
  type DeepLinkIntent,
} from '../lib/deepLinks';
import { logInfo, logWarn } from '../lib/logger';
import {
  getLastNotificationOpenEvent,
  subscribeToNotificationOpens,
  type NotificationOpenEvent,
} from '../services/pushNotifications';

type DeepLinkSource = 'initial-url' | 'url-event' | 'notification';

type DeepLinkContextValue = {
  pendingIntent: DeepLinkIntent | null;
  consumeIntent: (intent: DeepLinkIntent) => void;
};

const DeepLinkContext = createContext<DeepLinkContextValue | null>(null);
const campaignOpenQueue = createCampaignOpenQueue(AsyncStorage);

/**
 * Owns the single native URL subscription for the app process. This provider
 * mounts above RootNavigator's visual/bootstrap gate, so recognized intents
 * survive until AppShell is actually allowed to mount and consume them.
 */
export function DeepLinkProvider({ children }: { children: React.ReactNode }) {
  const [pendingIntent, setPendingIntent] = useState<DeepLinkIntent | null>(null);
  const pendingIntentRef = useRef<DeepLinkIntent | null>(null);

  const enqueueIntent = useCallback((intent: DeepLinkIntent, source: DeepLinkSource) => {
    const current = pendingIntentRef.current;
    const next = enqueueDeepLinkIntent(current, intent);

    if (next === current) {
      logInfo('deepLinks', 'intent_already_pending', { source, intentType: intent.type });
      return;
    }

    pendingIntentRef.current = next;
    setPendingIntent(next);
    logInfo('deepLinks', 'intent_enqueued', { source, intentType: intent.type });
  }, []);

  const handleUrl = useCallback((url: string, source: DeepLinkSource) => {
    logInfo('deepLinks', 'deep_link_received', { source });
    const intent = parseDeepLink(url);

    if (!intent) {
      logInfo('deepLinks', 'deep_link_ignored', { source });
      return;
    }

    logInfo('deepLinks', 'deep_link_recognized', { source, intentType: intent.type });
    enqueueIntent(intent, source);
  }, [enqueueIntent]);

  useEffect(() => {
    let mounted = true;
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url, 'url-event');
    });

    void Linking.getInitialURL()
      .then((url) => {
        if (mounted && url) handleUrl(url, 'initial-url');
      })
      .catch(() => {
        if (mounted) logWarn('deepLinks', 'initial_url_read_failed');
      });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [handleUrl]);

  useEffect(() => {
    const recordOpen = httpsCallable(functions, 'recordCampaignOpen');
    const flushOpens = () => {
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      void campaignOpenQueue.flush(uid, async (open) => {
        if (auth.currentUser?.uid !== open.uid) throw new Error('campaign_open_user_changed');
        await recordOpen({ campaignId: open.campaignId, campaignRunId: open.campaignRunId });
      }).catch(() => logWarn('deepLinks', 'campaign_open_record_failed'));
    };
    const unsubscribeAuth = onAuthStateChanged(auth, flushOpens);
    const handleNotification = (event: NotificationOpenEvent) => {
      const { payload } = event;
      if ((payload?.type === 'SUPPORT_SINGLE_REPLY' || payload?.type === 'SUPPORT_CHAT_MESSAGE') && payload.caseId) {
        enqueueIntent({ type: 'support-case', caseId: payload.caseId }, 'notification');
      }
      if (payload?.type === 'CAMPAIGN' && payload.destination && payload.campaignId && payload.campaignRunId) {
        enqueueIntent({ type: 'campaign-tab', tab: payload.destination }, 'notification');
        if (!payload.campaignRunId.startsWith('test.') && payload.recipientUid) {
          void campaignOpenQueue.enqueue(payload.recipientUid, payload.campaignId, payload.campaignRunId)
            .then(flushOpens)
            .catch(() => logWarn('deepLinks', 'campaign_open_persist_failed'));
        }
      }
    };
    const unsubscribe = subscribeToNotificationOpens(handleNotification);
    const initial = getLastNotificationOpenEvent();
    if (initial) handleNotification(initial);
    const retryTimer = setInterval(flushOpens, 30000);
    return () => { unsubscribe(); unsubscribeAuth(); clearInterval(retryTimer); };
  }, [enqueueIntent]);

  const consumeIntent = useCallback((intent: DeepLinkIntent) => {
    const current = pendingIntentRef.current;
    const next = consumePendingIntent(current, intent);
    if (next === current) return;

    pendingIntentRef.current = next;
    setPendingIntent(next);
    logInfo('deepLinks', 'intent_consumed', { intentType: intent.type });
  }, []);

  return (
    <DeepLinkContext.Provider value={{ pendingIntent, consumeIntent }}>
      {children}
    </DeepLinkContext.Provider>
  );
}

export function useDeepLinkIntent(): DeepLinkContextValue {
  const context = useContext(DeepLinkContext);
  if (!context) throw new Error('useDeepLinkIntent outside provider');
  return context;
}
