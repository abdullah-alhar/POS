import { useQuery } from '@tanstack/react-query';
import { hasPermission, type AuthUser, type Permission } from '@shoppos/shared';
import { api, ApiError } from './api';
import { keys } from './queries';

/** The logged-in user, or null. */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<AuthUser>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'UNAUTHORIZED') return null;
        throw err;
      }
    },
    staleTime: Infinity,
    meta: { silent: true },
  });
}

export function useCan() {
  const { data: me } = useMe();
  return (permission: Permission) => (me ? hasPermission(me, permission) : false);
}
