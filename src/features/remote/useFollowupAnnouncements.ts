import type { RemoteFollowupState } from '@/features/remote/followupState';

export function useFollowupAnnouncements(state: RemoteFollowupState): string {
  if (state.status === 'requesting') return 'Die Rückfrage wird gesendet.';
  if (state.status === 'streaming') return 'Die Antwort auf die Rückfrage wird übertragen.';
  if (state.status === 'terminal_waiting_for_eof') {
    return 'Die Antwort wurde empfangen und wird sicher abgeschlossen.';
  }
  if (state.status === 'cancelled') return 'Die Rückfrage wurde abgebrochen.';
  if (state.status === 'complete') return state.completedAnswer ?? '';
  return '';
}
