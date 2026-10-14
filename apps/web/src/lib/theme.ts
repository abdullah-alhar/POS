import { create } from 'zustand';
import { safeStorage } from './storage';

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'pos-theme';
const media =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function resolve(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return media?.matches ? 'dark' : 'light';
  return choice;
}

function apply(resolved: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

interface ThemeState {
  theme: ThemeChoice;
  resolved: 'light' | 'dark';
  setTheme: (theme: ThemeChoice) => void;
  toggle: () => void;
}

const initial = (safeStorage.get(KEY) as ThemeChoice | null) ?? 'light';

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial,
  resolved: resolve(initial),
  setTheme(theme) {
    safeStorage.set(KEY, theme);
    const resolved = resolve(theme);
    apply(resolved);
    set({ theme, resolved });
  },
  toggle() {
    get().setTheme(get().resolved === 'dark' ? 'light' : 'dark');
  },
}));

media?.addEventListener('change', () => {
  const { theme, setTheme } = useTheme.getState();
  if (theme === 'system') setTheme('system');
});
