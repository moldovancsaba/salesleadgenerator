'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { SsoAppRole, SsoPermissionStatus } from '@/lib/sso';

// Issue #102, phase 1: SSO plumbing only. This provider is NOT mounted in
// app/layout.tsx yet — doing so would add a background session-check fetch
// to every page load, a real behavior change bound up with the same open
// question already flagged in issue #102 (which pages, if any, should
// actually require login). Available and ready to wire in once that's
// decided; importing/using it anywhere today is a no-op until then.

type SsoUser = {
  id: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
};

type SsoPermission = {
  status: SsoPermissionStatus;
  role: SsoAppRole | null;
} | null;

type AuthContextValue = {
  user: SsoUser | null;
  permission: SsoPermission;
  loading: boolean;
  isApproved: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SsoUser | null>(null);
  const [permission, setPermission] = useState<SsoPermission>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setPermission(data.permission ?? null);
      } else {
        setUser(null);
        setPermission(null);
      }
    } catch (err) {
      console.error('[AuthProvider] session check failed:', err);
      setUser(null);
      setPermission(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(() => {
    window.location.href = '/api/auth/login';
  }, []);

  const logout = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      setUser(null);
      setPermission(null);
      if (data.ssoLogoutUrl) {
        window.location.href = data.ssoLogoutUrl;
      }
    } catch (err) {
      console.error('[AuthProvider] logout failed:', err);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        permission,
        loading,
        isApproved: permission?.status === 'approved',
        login,
        logout,
        refresh: checkSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
