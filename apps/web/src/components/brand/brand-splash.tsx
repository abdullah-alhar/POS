import { useEffect, useId, useState } from 'react';
import { cachedBrand, useBranding } from '@/lib/branding';
import { LOGO_MARK, LOGO_VIEWBOX, LOGO_WORDMARK } from './logo-paths';

const PLAYED_KEY = 'pos-splash-played';
const REPLAY_EVENT = 'pos:replay-splash';
const DURATION_MS = 3500;

function alreadyPlayed() {
  try {
    return sessionStorage.getItem(PLAYED_KEY) === '1';
  } catch {
    return false;
  }
}

function markPlayed() {
  try {
    sessionStorage.setItem(PLAYED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Play the startup animation again (used by the Branding page preview). */
export function replaySplash() {
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

/**
 * The logo animation shown when the POS opens: once per browser session, skipped with any key
 * or click, and switched off in Branding settings.
 */
export function BrandSplash() {
  const [run, setRun] = useState(() =>
    cachedBrand().startupAnimation && !alreadyPlayed() ? 1 : 0,
  );
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const replay = () => {
      setLeaving(false);
      setRun((r) => r + 1);
    };
    window.addEventListener(REPLAY_EVENT, replay);
    return () => window.removeEventListener(REPLAY_EVENT, replay);
  }, []);

  useEffect(() => {
    if (!run) return;
    markPlayed();
    const done = window.setTimeout(() => setRun(0), DURATION_MS);
    const skip = () => {
      setLeaving(true);
      window.setTimeout(() => setRun(0), 300);
    };
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      window.clearTimeout(done);
      window.removeEventListener('keydown', skip);
    };
  }, [run]);

  if (!run) return null;
  return (
    <div
      key={run}
      className="splash"
      data-leaving={leaving}
      aria-hidden="true"
      onClick={() => {
        setLeaving(true);
        window.setTimeout(() => setRun(0), 300);
      }}
    >
      <div className="splash-aura" />
      <div className="splash-stage">
        <SplashLogo />
        <div className="splash-progress" />
      </div>
    </div>
  );
}

function SplashLogo() {
  const branding = useBranding();
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, '');

  if (branding.logo) {
    return <img src={branding.logo} alt="" className="splash-image" />;
  }
  return (
    <svg viewBox={LOGO_VIEWBOX} className="splash-logo" fillRule="evenodd">
      <defs>
        <clipPath id={`clip-${uid}`}>
          {[...LOGO_MARK, ...LOGO_WORDMARK].map((d, i) => (
            <path key={i} d={d} clipRule="evenodd" />
          ))}
        </clipPath>
        <linearGradient id={`shine-${uid}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {LOGO_MARK.map((d, i) => (
        <path
          key={i}
          className="splash-mark"
          style={{ '--i': i } as React.CSSProperties}
          pathLength={1}
          d={d}
        />
      ))}
      {LOGO_WORDMARK.map((d, i) => (
        <path key={i} className="splash-letter" style={{ '--i': i } as React.CSSProperties} d={d} />
      ))}
      <g clipPath={`url(#clip-${uid})`}>
        <rect
          className="splash-shine"
          x="0"
          y="-20"
          width="120"
          height="200"
          fill={`url(#shine-${uid})`}
        />
      </g>
    </svg>
  );
}
