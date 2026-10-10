import { QueryClient } from '@tanstack/react-query';

// The app's one React Query client. Shared as a module so non-component code
// (e.g. the agent store refreshing note lists after a bulk Apply/Undo) can
// invalidate queries too.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds stale time
      refetchOnWindowFocus: true,
    },
  },
});
