'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { SsoAppRole, SsoPermissionStatus } from '@/lib/sso';
import type { OrgRole, PreferredStartScreen } from '@/lib/sso-access';
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
  orgRoles: Partial<Record<Brand, OrgRole>>;
  isSuperAdmin: boolean;
  hasSeenTour: boolean;
  preferredStartScreen: PreferredStartScreen | null;
  hideNeedsReplyByBrand: Record<string, boolean>;
  loading: boolean;
  isApproved: boolean;
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SsoUser | null>(null);
  const [permission, setPermission] = useState<SsoPermission>(null);
  const [accessibleBrands, setAccessibleBrands] = useState<Brand[]>([]);
  const [brandLabels, setBrandLabels] = useState<Record<string, string>>({});
  const [orgRoles, setOrgRoles] = useState<Partial<Record<Brand, OrgRole>>>({});
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [hasSeenTour, setHasSeenTour] = useState(false);
  const [preferredStartScreen, setPreferredStartScreen] = useState<PreferredStartScreen | null>(null);
  const [hideNeedsReplyByBrand, setHideNeedsReplyByBrand] = useState<Record<string, boolean>>({});
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
        setOrgRoles(data.orgRoles ?? {});
        setIsSuperAdmin(Boolean(data.isSuperAdmin));
        setHasSeenTour(Boolean(data.hasSeenTour));
        setPreferredStartScreen(data.preferredStartScreen ?? null);
        setHideNeedsReplyByBrand(data.hideNeedsReplyByBrand ?? {});
      } else {
        setUser(null);
        setPermission(null);
        setAccessibleBrands([]);
        setBrandLabels({});
        setOrgRoles({});
        setIsSuperAdmin(false);
        setHasSeenTour(false);
        setPreferredStartScreen(null);
        setHideNeedsReplyByBrand({});
      }
    } catch (err) {
      console.error('[AuthProvider] session check failed:', err);
      setUser(null);
      setPermission(null);
      setAccessibleBrands([]);
      setBrandLabels({});
      setOrgRoles({});
      setIsSuperAdmin(false);
      setHasSeenTour(false);
      setPreferredStartScreen(null);
      setHideNeedsReplyByBrand({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback((returnTo?: string) => {
    const suffix = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? `?returnTo=${encodeURIComponent(returnTo)}`
      : '';
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/auth/login${suffix}`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.error('[AuthProvider] logout failed:', err);
    } finally {
      setUser(null);
      setPermission(null);
      setAccessibleBrands([]);
      setBrandLabels({});
      setOrgRoles({});
      setIsSuperAdmin(false);
      setHasSeenTour(false);
      setPreferredStartScreen(null);
      setHideNeedsReplyByBrand({});
      // Hard navigation to '/' ensures full cleanup of in-memory client state
      // and router caches across all tenant workspaces on sign-out.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        permission,
        accessibleBrands,
        brandLabels,
        orgRoles,
        isSuperAdmin,
        hasSeenTour,
        preferredStartScreen,
        hideNeedsReplyByBrand,
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
