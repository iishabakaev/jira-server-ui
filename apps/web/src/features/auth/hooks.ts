import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  attachJiraPat,
  fetchJiraPat,
  fetchMe,
  fetchProviders,
  loginLocal,
  logout,
  type MeResponse,
  removeJiraPat,
  testJiraPat,
} from './api'

// React Query hooks для auth. Кеш-ключ ['auth','me'] — единственный
// глобальный источник пользователя для роутера и UI.

export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
  providers: () => [...authKeys.all, 'providers'] as const,
  pat: () => [...authKeys.all, 'pat'] as const,
}

export function useMe() {
  return useQuery<MeResponse | null>({
    queryKey: authKeys.me(),
    queryFn: fetchMe,
    staleTime: 60_000,
  })
}

export function useProviders() {
  return useQuery({
    queryKey: authKeys.providers(),
    queryFn: fetchProviders,
    staleTime: 5 * 60_000,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      loginLocal(username, password),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: authKeys.me() })
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      qc.setQueryData(authKeys.me(), null)
      void qc.invalidateQueries({ queryKey: authKeys.me() })
    },
  })
}

export function usePatStatus() {
  return useQuery({
    queryKey: authKeys.pat(),
    queryFn: fetchJiraPat,
    staleTime: 30_000,
  })
}

export function useAttachPat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => attachJiraPat(token),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: authKeys.me() })
      void qc.invalidateQueries({ queryKey: authKeys.pat() })
    },
  })
}

export function useRemovePat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: removeJiraPat,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: authKeys.me() })
      void qc.invalidateQueries({ queryKey: authKeys.pat() })
    },
  })
}

export function useTestPat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: testJiraPat,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: authKeys.me() })
      void qc.invalidateQueries({ queryKey: authKeys.pat() })
    },
  })
}
