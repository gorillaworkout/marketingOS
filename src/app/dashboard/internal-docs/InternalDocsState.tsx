'use client';

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { FaqAskMessage } from './FaqAskPanel';
import { getFaqAskServerSnapshot, getFaqAskSnapshot, saveFaqAskMessages, subscribeFaqAskMessages } from './faq-ask-session';

interface GuideRoute {
  documentId?: string;
  highlight: string;
}

interface InternalDocsStateValue {
  messages: FaqAskMessage[];
  setMessages: (update: FaqAskMessage[] | ((current: FaqAskMessage[]) => FaqAskMessage[])) => void;
  documentId?: string;
  highlight: string;
  setRoute: (route: GuideRoute) => void;
}

const InternalDocsStateContext = createContext<InternalDocsStateValue | null>(null);

export function InternalDocsProvider({ children }: { children: ReactNode }) {
  const messages = useSyncExternalStore(subscribeFaqAskMessages, getFaqAskSnapshot, getFaqAskServerSnapshot);
  const [route, setRouteState] = useState<GuideRoute>({ highlight: '' });

  const setMessages = useCallback((update: FaqAskMessage[] | ((current: FaqAskMessage[]) => FaqAskMessage[])) => {
    const current = getFaqAskSnapshot();
    const next = typeof update === 'function' ? update(current) : update;
    saveFaqAskMessages(next);
  }, []);

  const setRoute = useCallback((next: GuideRoute) => {
    setRouteState(current => {
      if (current.documentId === next.documentId && current.highlight === next.highlight) return current;
      return { documentId: next.documentId, highlight: next.highlight };
    });
  }, []);

  const value = useMemo<InternalDocsStateValue>(() => ({
    messages,
    setMessages,
    documentId: route.documentId,
    highlight: route.highlight,
    setRoute,
  }), [messages, route.documentId, route.highlight, setMessages, setRoute]);

  return <InternalDocsStateContext.Provider value={value}>{children}</InternalDocsStateContext.Provider>;
}

export function useInternalDocsState(): InternalDocsStateValue {
  const value = useContext(InternalDocsStateContext);
  if (!value) throw new Error('FAQ & Guides state is unavailable.');
  return value;
}
