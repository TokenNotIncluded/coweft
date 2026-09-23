import { useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, write, type Command, type Me } from '../api';

export function useMe() {
  return useQuery({
    queryKey: ['me'], retry: false,
    queryFn: async () => {
      try { return await api<Me>('/api/me'); }
      catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
    },
  });
}

/** Preserve the operation identity after an ambiguous timeout. A changed
 * payload gets a new identity; a retry of the same intent never duplicates it. */
export function useCommand(onSuccess?: (result: { id?: string }, command: Command) => void) {
  const me = useMe();
  const client = useQueryClient();
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  return useMutation({
    retry: false,
    mutationFn: (command: Command) => {
      const fingerprint = JSON.stringify([me.data?.account.id, command]);
      if (pending.current?.fingerprint !== fingerprint) {
        pending.current = { fingerprint, key: crypto.randomUUID() };
      }
      return write<{ id?: string }>('/api/commands', { idempotency_key: pending.current.key, command }, me.data);
    },
    onSuccess: (result, command) => {
      pending.current = null;
      for (const key of ['threads', 'thread', 'proposals']) void client.invalidateQueries({ queryKey: [key] });
      onSuccess?.(result, command);
    },
  });
}
