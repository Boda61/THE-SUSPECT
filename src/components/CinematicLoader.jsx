import { useEffect, useState, useRef, useCallback } from 'react';

// Messages cycle based on initialization phase
const LOADING_MESSAGES = [
  'INITIALIZING CASE...',
  'SECURING EVIDENCE...',
  'PREPARING INVESTIGATION...',
  'CONNECTING PLAYERS...',
];

// Minimum display durations (ms) for visual consistency
const MIN_INTRO_DURATION = 2200;
const FADE_DURATION = 700;

/**
 * CinematicLoader
 *
 * Props:
 *   isAppReady  {boolean}  — set true when app initialization is complete
 *   onDone      {function} — called after fade-out, so parent can unmount this component
 */
export default function CinematicLoader({ isAppReady, onDone }) {
  const [phase, setPhase] = useState('enter');   // enter | exit
  const [msgIndex, setMsgIndex] = useState(0);
  const [scanPos, setScanPos] = useState(-10);
  const minTimerRef = useRef(null);
  const msgTimerRef = useRef(null);
  const scanRef = useRef(null);
  const readyRef = useRef(false);
  const exitCalledRef = useRef(false);

  const triggerExit = useCallback(() => {
    if (exitCalledRef.current) return;
    exitCalledRef.current = true;
    clearInterval(msgTimerRef.current);
    cancelAnimationFrame(scanRef.current);
    setPhase('exit');
    setTimeout(() => {
      onDone?.();
    }, FADE_DURATION);
  }, [onDone]);

  // Cycle loading messages every 700ms
  useEffect(() => {
    msgTimerRef.current = setInterval(() => {
      setMsgIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, 700);
    return () => clearInterval(msgTimerRef.current);
  }, []);

  // Animate the scanning line via rAF
  useEffect(() => {
    let pos = -10;
    const step = () => {
      pos = pos > 110 ? -10 : pos + 0.55;
      setScanPos(pos);
      scanRef.current = requestAnimationFrame(step);
    };
    scanRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(scanRef.current);
  }, []);

  // Start minimum timer on mount
  useEffect(() => {
    minTimerRef.current = setTimeout(() => {
      readyRef.current = true;
      if (isAppReady) triggerExit();
    }, MIN_INTRO_DURATION);
    return () => clearTimeout(minTimerRef.current);
  }, [isAppReady, triggerExit]);

  // Watch isAppReady after min timer has elapsed
  useEffect(() => {
    if (isAppReady && readyRef.current) {
      triggerExit();
    }
  }, [isAppReady, triggerExit]);

  const isExiting = phase === 'exit';

  return (
    <div
      aria-label="جاري تحميل التطبيق"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#05050a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? 'scale(1.04)' : 'scale(1)',
        filter: isExiting ? 'blur(6px)' : 'blur(0px)',
        transition: isExiting
          ? `opacity ${FADE_DURATION}ms cubic-bezier(0.4,0,0.2,1), transform ${FADE_DURATION}ms cubic-bezier(0.4,0,0.2,1), filter ${FADE_DURATION}ms cubic-bezier(0.4,0,0.2,1)`
          : 'none',
        willChange: 'opacity, transform, filter',
      }}
    >
      {/* Film grain overlay — CSS only */}
      <div className="cl-grain" aria-hidden="true" />

      {/* Ambient glow top */}
      <div className="cl-glow-top" aria-hidden="true" />

      {/* Ambient glow bottom */}
      <div className="cl-glow-bottom" aria-hidden="true" />

      {/* Vignette */}
      <div className="cl-vignette" aria-hidden="true" />

      {/* Scanning line */}
      <div
        aria-hidden="true"
        className="cl-scan-line"
        style={{ top: `${scanPos}%` }}
      />

      {/* Main content */}
      <div className="cl-content">

        {/* Magnifier icon */}
        <div className="cl-icon-wrap cl-reveal" aria-hidden="true">
          <svg
            className="cl-icon"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="26" cy="26" r="16" stroke="#b59b6a" strokeWidth="2.5" />
            <circle cx="26" cy="26" r="8" stroke="#b59b6a" strokeWidth="1.5" strokeDasharray="4 3" />
            <circle cx="26" cy="26" r="2.5" fill="#b59b6a" />
            <line x1="37.5" y1="37.5" x2="56" y2="56" stroke="#b59b6a" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>

        {/* Arabic title */}
        <h1 className="cl-title cl-reveal cl-reveal-delay-1" lang="ar">
          المشتبه به
        </h1>

        {/* English brand */}
        <div className="cl-brand cl-reveal cl-reveal-delay-2" lang="en">
          THE SUSPECT
        </div>

        {/* Gold divider */}
        <div className="cl-divider cl-reveal cl-reveal-delay-3" aria-hidden="true" />

        {/* Tagline */}
        <p className="cl-tagline cl-reveal cl-reveal-delay-3">
          EVERY CLUE MATTERS.
        </p>

        {/* Animated indeterminate progress bar */}
        <div className="cl-bar-wrap cl-reveal cl-reveal-delay-4" aria-hidden="true">
          <div className="cl-bar-track">
            <div className="cl-bar-fill" />
          </div>
        </div>

        {/* Loading message */}
        <p className="cl-msg" key={msgIndex} aria-live="polite">
          {LOADING_MESSAGES[msgIndex]}
        </p>

      </div>

      {/* Corner frame accents */}
      <div className="cl-corner cl-corner-tl" aria-hidden="true" />
      <div className="cl-corner cl-corner-br" aria-hidden="true" />
    </div>
  );
}
