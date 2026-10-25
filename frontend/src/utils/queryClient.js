import { QueryClient } from '@tanstack/react-query';

// The app's one React Query client. Shared as a module so non-component code
// (e.g. the agent store refreshing note lists after a bulk Apply/Undo) can
// invalidate queries too.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30, // 30 seconds stale time
      // Retry only what may pass next time (network, 5xx); a 4xx answer won't change by asking again
      retry: (failureCount, error) => {
        const status = error?.response?.status;
        return failureCount < 2 && !(status >= 400 && status < 500);
      },
    },
  },
});
