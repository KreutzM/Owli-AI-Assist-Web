import { useEffect, useRef, useState } from 'react';
import type { RemoteSceneState } from '@/features/remote/useRemoteScene';

const ANNOUNCEMENT_INTERVAL_MS = 2_000;
const SENTENCE_BOUNDARY = /[.!?…][”"')\]]?\s*$/u;

export function useSceneAnnouncements(state: RemoteSceneState): string {
  const [announcement, setAnnouncement] = useState('');
  const lastAt = useRef(0);
  const announcedLength = useRef(0);
  const completion = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (state.status === 'requesting') {
      setAnnouncement('Die Szenenbeschreibung wird angefordert.');
      lastAt.current = Date.now();
      announcedLength.current = 0;
      completion.current = undefined;
      return;
    }
    if (state.status === 'terminal_waiting_for_eof') {
      setAnnouncement('Die Antwort wurde empfangen und wird sicher abgeschlossen.');
      return;
    }
    if (state.status === 'cancelled') {
      setAnnouncement('Der Vorgang wurde abgebrochen.');
      return;
    }
    if (state.status === 'complete' && state.finalText && completion.current !== state.finalText) {
      completion.current = state.finalText;
      announcedLength.current = state.finalText.length;
      setAnnouncement(state.finalText);
    }
  }, [state.finalText, state.status]);

  useEffect(() => {
    if (state.status !== 'streaming' || !state.streamedText) return;
    if (!SENTENCE_BOUNDARY.test(state.streamedText)) return;
    const dueIn = Math.max(0, lastAt.current + ANNOUNCEMENT_INTERVAL_MS - Date.now());
    const timer = setTimeout(() => {
      const segment = state.streamedText.slice(announcedLength.current).trim();
      if (!segment) return;
      announcedLength.current = state.streamedText.length;
      lastAt.current = Date.now();
      setAnnouncement(segment);
    }, dueIn);
    return () => clearTimeout(timer);
  }, [state.status, state.streamedText]);

  return announcement;
}
