import { useEffect, useRef, useState } from 'react';
import type { RemoteSceneState } from '@/features/remote/useRemoteScene';

const ANNOUNCEMENT_INTERVAL_MS = 2_000;
const SENTENCE_BOUNDARY = /[.!?…][”"')\]]?\s*$/u;

interface StreamAnnouncement {
  run: number;
  text: string;
}

export function useSceneAnnouncements(state: RemoteSceneState): string {
  const [streamAnnouncement, setStreamAnnouncement] = useState<StreamAnnouncement>({
    run: 0,
    text: '',
  });
  const lastAt = useRef(0);
  const announcedLength = useRef(0);

  useEffect(() => {
    if (state.status !== 'requesting') return;
    lastAt.current = Date.now();
    announcedLength.current = 0;
  }, [state.status]);

  useEffect(() => {
    if (state.status !== 'streaming' || !state.streamedText) return;
    if (!SENTENCE_BOUNDARY.test(state.streamedText)) return;
    const currentRun = state.announcementRun ?? 0;
    const dueIn = Math.max(0, lastAt.current + ANNOUNCEMENT_INTERVAL_MS - Date.now());
    const timer = setTimeout(() => {
      const segment = state.streamedText.slice(announcedLength.current).trim();
      if (!segment) return;
      announcedLength.current = state.streamedText.length;
      lastAt.current = Date.now();
      setStreamAnnouncement({ run: currentRun, text: segment });
    }, dueIn);
    return () => clearTimeout(timer);
  }, [state.announcementRun, state.status, state.streamedText]);

  if (state.status === 'requesting') return 'Die Szenenbeschreibung wird angefordert.';
  if (state.status === 'terminal_waiting_for_eof') {
    return 'Die Antwort wurde empfangen und wird sicher abgeschlossen.';
  }
  if (state.status === 'cancelled') return 'Der Vorgang wurde abgebrochen.';
  if (state.status === 'complete') return state.finalText ?? '';
  if (
    state.status === 'streaming' &&
    streamAnnouncement.run === (state.announcementRun ?? 0)
  ) {
    return streamAnnouncement.text;
  }
  return '';
}
