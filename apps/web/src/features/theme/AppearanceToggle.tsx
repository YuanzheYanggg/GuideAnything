import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Appearance = 'system' | 'light' | 'dark';

const appearanceStorageKey = 'guideanything-appearance';
const appearanceOptions: Array<{ value: Appearance; label: string }> = [
  { value: 'system', label: '系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

interface AppearanceContextValue {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children, initialAppearance }: { children: ReactNode; initialAppearance?: Appearance }) {
  const [appearance, setAppearance] = useState<Appearance>(() => initialAppearance ?? readStoredAppearance());

  useEffect(() => {
    applyAppearance(appearance);
    localStorage.setItem(appearanceStorageKey, appearance);
  }, [appearance]);

  const value = useMemo(() => ({ appearance, setAppearance }), [appearance]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function AppearanceToggle() {
  const context = useContext(AppearanceContext);
  const [localAppearance, setLocalAppearance] = useState<Appearance>(() => readStoredAppearance());
  const appearance = context?.appearance ?? localAppearance;
  const setAppearance = context?.setAppearance ?? setLocalAppearance;

  useEffect(() => {
    applyAppearance(appearance);
    localStorage.setItem(appearanceStorageKey, appearance);
  }, [appearance]);

  return (
    <div className="appearance-toggle" role="group" aria-label="外观">
      {appearanceOptions.map((option) => (
        <button
          key={option.value}
          className={appearance === option.value ? 'is-selected' : undefined}
          type="button"
          aria-label={appearance === option.value ? `当前为${option.label}` : `切换到${option.label}`}
          aria-pressed={appearance === option.value}
          onClick={() => setAppearance(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function readStoredAppearance(): Appearance {
  const stored = localStorage.getItem(appearanceStorageKey);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function resolveAppearance(appearance: Appearance): Exclude<Appearance, 'system'> {
  if (appearance !== 'system') return appearance;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyAppearance(appearance: Appearance) {
  const resolved = resolveAppearance(appearance);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#111216' : '#F5F5F7');
}
