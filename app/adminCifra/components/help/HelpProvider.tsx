'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { useUserRole } from '@/app/providers/UserRoleProvider';
import {
  getHelpArticle,
  getHelpArticleForRoute,
  getOnboardingArticleIds,
  getOnboardingArticles,
  hasHelpOnboarding,
  isHelpEnabledForRole,
  listHelpArticlesForRole,
  setRuntimeHelpArticles,
} from '@/lib/help/registry';
import {
  isHelpOnboardingCompleted,
  loadHelpOnboardingReadIds,
  markHelpOnboardingCompleted,
  saveHelpOnboardingReadIds,
} from '@/lib/help/storage';
import type { HelpArticle, HelpRole } from '@/lib/help/types';
import HelpDrawer from './HelpDrawer';
import HelpOnboardingModal from './HelpOnboardingModal';

/** Явная идентичность (водитель на mobile — без users.role). */
export type HelpProviderIdentity = {
  role: HelpRole;
  storageKey: string;
};

type HelpContextValue = {
  helpEnabled: boolean;
  openPageHelp: () => void;
  openCatalog: () => void;
  openArticle: (id: string) => void;
  reopenOnboarding: () => void;
};

const HelpContext = createContext<HelpContextValue | null>(null);

export function useHelp(): HelpContextValue {
  const ctx = useContext(HelpContext);
  if (!ctx) {
    return {
      helpEnabled: false,
      openPageHelp: () => {},
      openCatalog: () => {},
      openArticle: () => {},
      reopenOnboarding: () => {},
    };
  }
  return ctx;
}

function allOnboardingRead(role: string | null, readIds: Set<string>): boolean {
  const ids = getOnboardingArticleIds(role);
  return ids.length > 0 && ids.every((id) => readIds.has(id));
}

export default function HelpProvider({
  children,
  identity,
}: {
  children: ReactNode;
  identity?: HelpProviderIdentity;
}) {
  const { user, loading } = useUserRole();
  const pathname = usePathname() || '';
  const role = identity?.role ?? user?.role ?? null;
  const [staffUserId, setStaffUserId] = useState<string | null>(null);
  const helpEnabled = isHelpEnabledForRole(role);
  const storageKey = identity?.storageKey ?? staffUserId;
  const roleReady = identity ? true : !loading;
  const [articlesVersion, setArticlesVersion] = useState(0);

  useEffect(() => {
    if (identity) return;
    try {
      setStaffUserId(localStorage.getItem('userId'));
    } catch {
      setStaffUserId(null);
    }
  }, [user, identity]);

  useEffect(() => {
    if (!helpEnabled) return;
    let cancelled = false;
    fetch('/api/adminCifra/help-articles')
      .then((r) => r.json())
      .then((data: { articles?: HelpArticle[] }) => {
        if (cancelled || !Array.isArray(data.articles)) return;
        setRuntimeHelpArticles(data.articles);
        setArticlesVersion((v) => v + 1);
      })
      .catch(() => {
        /* дефолты из кода */
      });
    return () => {
      cancelled = true;
    };
  }, [helpEnabled]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [catalogMode, setCatalogMode] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  /** Уже пройден / закрыт кнопкой «Всё понял» — больше не показываем автоматически. */
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const hydratedRef = useRef<string | null>(null);
  /** Вернуть чеклист после закрытия drawer только если открыли статью из него (не после «Позже»). */
  const resumeOnboardingRef = useRef(false);

  const onboardingArticles = useMemo(
    () => (helpEnabled && hasHelpOnboarding(role) ? getOnboardingArticles(role) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [helpEnabled, role, articlesVersion],
  );
  const catalog = useMemo(
    () => listHelpArticlesForRole(role),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, articlesVersion],
  );

  // Гидратация флага завершения и прогресса прочтения из localStorage
  useEffect(() => {
    if (!roleReady || !helpEnabled || !hasHelpOnboarding(role) || storageKey == null || !role) {
      return;
    }
    const hydrateKey = `${storageKey}:${role}`;
    if (hydratedRef.current === hydrateKey) return;
    hydratedRef.current = hydrateKey;

    const done = isHelpOnboardingCompleted(storageKey, role);
    const savedRead = loadHelpOnboardingReadIds(storageKey, role);
    const readSet = new Set(savedRead);
    if (savedRead.length) setReadIds(readSet);

    if (done) {
      setOnboardingDone(true);
      setOnboardingOpen(false);
      return;
    }

    // Уже открывал все пункты раньше, но не нажал «Всё понял» — считаем пройденным
    if (allOnboardingRead(role, readSet)) {
      markHelpOnboardingCompleted(storageKey, role);
      setOnboardingDone(true);
      setOnboardingOpen(false);
      return;
    }

    setOnboardingDone(false);
    setOnboardingOpen(true);
  }, [roleReady, helpEnabled, role, storageKey]);

  useEffect(() => {
    if (!article) return;
    const fresh = getHelpArticle(article.id);
    if (fresh) setArticle(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articlesVersion]);

  const persistComplete = useCallback(() => {
    if (storageKey != null && role) {
      markHelpOnboardingCompleted(storageKey, role);
    }
    setOnboardingDone(true);
    setOnboardingOpen(false);
  }, [storageKey, role]);

  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        if (storageKey != null && role) {
          saveHelpOnboardingReadIds(storageKey, role, next);
        }
        return next;
      });
    },
    [storageKey, role],
  );

  const openArticle = useCallback(
    (id: string, fromOnboarding = false) => {
      const a = getHelpArticle(id);
      if (!a) return;
      if (fromOnboarding) resumeOnboardingRef.current = true;
      setArticle(a);
      setCatalogMode(false);
      setDrawerOpen(true);
      markRead(id);
    },
    [markRead, articlesVersion],
  );

  const openPageHelp = useCallback(() => {
    if (!helpEnabled) return;
    const a =
      getHelpArticleForRoute(pathname, role) ??
      getOnboardingArticles(role)[0] ??
      listHelpArticlesForRole(role)[0];
    setArticle(a ?? null);
    setCatalogMode(false);
    setDrawerOpen(true);
    if (a) markRead(a.id);
  }, [helpEnabled, pathname, role, markRead, articlesVersion]);

  const openCatalog = useCallback(() => {
    if (!helpEnabled) return;
    setArticle(null);
    setCatalogMode(true);
    setDrawerOpen(true);
  }, [helpEnabled]);

  const reopenOnboarding = useCallback(() => {
    if (!hasHelpOnboarding(role)) return;
    setOnboardingDone(false);
    setOnboardingOpen(true);
  }, [role]);

  const skipOnboarding = useCallback(() => {
    // «Позже» — скрыть до следующего захода в систему (не пишем completed)
    resumeOnboardingRef.current = false;
    setOnboardingOpen(false);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    // Все пункты открыты → опрос пройден, модалка больше не появится
    if (!onboardingDone && allOnboardingRead(role, readIds)) {
      resumeOnboardingRef.current = false;
      persistComplete();
      return;
    }
    if (resumeOnboardingRef.current && !onboardingDone) {
      setOnboardingOpen(true);
    }
    resumeOnboardingRef.current = false;
  }, [onboardingDone, role, readIds, persistComplete]);

  const value = useMemo<HelpContextValue>(
    () => ({
      helpEnabled,
      openPageHelp,
      openCatalog,
      openArticle: (id: string) => openArticle(id, false),
      reopenOnboarding,
    }),
    [helpEnabled, openPageHelp, openCatalog, openArticle, reopenOnboarding],
  );

  return (
    <HelpContext.Provider value={value}>
      {children}
      {helpEnabled && (
        <>
          <HelpDrawer
            open={drawerOpen}
            article={catalogMode ? null : article}
            catalog={catalogMode ? catalog : undefined}
            role={role}
            onSelectArticle={openArticle}
            onClose={closeDrawer}
          />
          <HelpOnboardingModal
            open={onboardingOpen && !drawerOpen && !onboardingDone}
            articles={onboardingArticles}
            readIds={readIds}
            onOpenArticle={(id) => openArticle(id, true)}
            onComplete={persistComplete}
            onSkip={skipOnboarding}
          />
        </>
      )}
    </HelpContext.Provider>
  );
}
