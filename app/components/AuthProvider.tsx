'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { SsoAppRole, SsoPermissionStatus } from '@/lib/sso';
import type { Brand } from '@/app/lib/brand';

// Issue #103: now mounted in app/components/Providers.tsx — the first page
// in this app to require a real login for any page. accessibleBrands drives
// app/components/AppNav.tsx's 0/1/2+-organization menu logic.

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
  accessibleBrands: Brand[];
  brandLabels: Record<string, string>;
  isSuperAdmin: boolean;
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
  const [accessibleBrands, setAccessibleBrands] = useState<Brand[]>([]);
  const [brandLabels, setBrandLabels] = useState<Record<string, string>>({});
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setPermission(data.permission ?? null);
        setAccessibleBrands(data.accessibleBrands ?? []);
        setBrandLabels(data.brandLabels ?? {});
        setIsSuperAdmin(Boolean(data.isSuperAdmin));
      } else {
        setUser(null);
        setPermission(null);
        setAccessibleBrands([]);
        setBrandLabels({});
        setIsSuperAdmin(false);
      }
    } catch (err) {
      console.error('[AuthProvider] session check failed:', err);
      setUser(null);
      setPermission(null);
      setAccessibleBrands([]);
      setBrandLabels({});
      setIsSuperAdmin(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(() => {
    // Issue #179 (Next.js 16.3.0 bump) — this new lint rule assumes a
    // relative-path destination is always an internal page reachable via
    // client-side routing. /api/auth/login is an API route that issues a
    // real server-side HTTP redirect chain into the SSO provider's own OAuth
    // flow; router.push() would perform a client-side transition instead of
    // a true browser navigation and never follow that redirect correctly.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/api/auth/login';
  }, []);

  const logout = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      setUser(null);
      setPermission(null);
      setAccessibleBrands([]);
      setBrandLabels({});
      setIsSuperAdmin(false);
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
        accessibleBrands,
        brandLabels,
        isSuperAdmin,
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
