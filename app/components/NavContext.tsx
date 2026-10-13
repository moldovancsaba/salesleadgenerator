'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

type NavContextValue = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleNav: () => void;
  isDesktopOrTablet: boolean;
};

const NavContext = createContext<NavContextValue | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }) {
  // On desktop and tablet (>= 768px), sidebar navigation is shown by default ("by design").
  // Users can hide/collapse it at any time, and their preference is saved in localStorage.
  const [sidebarOpen, setSidebarOpenState] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDesktopOrTablet, setIsDesktopOrTablet] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('slg_sidebar_open');
      if (stored === 'false') {
        setSidebarOpenState(false);
      }
    } catch {
      // Safe fallback for private browsing / blocked storage
    }

    if (typeof window !== 'undefined') {
      const checkBreakpoint = () => {
        setIsDesktopOrTablet(window.innerWidth >= 768);
      };
      checkBreakpoint();
      window.addEventListener('resize', checkBreakpoint);
      return () => window.removeEventListener('resize', checkBreakpoint);
    }
  }, []);

  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpenState(open);
    try {
      localStorage.setItem('slg_sidebar_open', String(open));
    } catch {
      // Safe fallback
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpenState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('slg_sidebar_open', String(next));
      } catch {
        // Safe fallback
      }
      return next;
    });
  }, []);

  const toggleNav = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setDrawerOpen((prev) => !prev);
    } else {
      toggleSidebar();
    }
  }, [toggleSidebar]);

  return (
    <NavContext.Provider
      value={{
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar,
        drawerOpen,
        setDrawerOpen,
        openDrawer: () => setDrawerOpen(true),
        closeDrawer: () => setDrawerOpen(false),
        toggleNav,
        isDesktopOrTablet,
      }}
    >
      {children}
    </NavContext.Provider>
  );
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) {
    throw new Error('useNav must be used within NavProvider');
  }
  return ctx;
}
