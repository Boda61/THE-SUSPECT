import { useEffect, useCallback } from 'react';
import { useVoiceChat } from '../hooks/useVoiceChat';

export default function VoiceChat({ roomId, userId, players }) {
  const { isTalking, activeSpeakers, micError, isConnected, startTalking, stopTalking } = useVoiceChat(roomId, userId);

  const handlePointerDown = useCallback((e) => {
    e.preventDefault();
    startTalking();
  }, [startTalking]);

  const handlePointerUp = useCallback((e) => {
    e.preventDefault();
    stopTalking();
  }, [stopTalking]);

  // Keyboard shortcut: hold Space to talk
  useEffect(() => {
    let active = false;
    const onKeyDown = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !active) {
        active = true;
        startTalking();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        active = false;
        stopTalking();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startTalking, stopTalking]);

  const getSpeakerName = (speakerId) => {
    const player = players?.find((p) => p.user_id === speakerId);
    return player?.display_name || 'لاعب';
  };

  return (
    <div style={{
      marginBottom: '1.5rem',
      padding: '1.25rem',
      background: 'rgba(0,0,0,0.3)',
      border: `1px solid ${isTalking ? 'rgba(74,222,128,0.5)' : 'rgba(99,102,241,0.25)'}`,
      borderRadius: 'var(--radius-lg)',
      transition: 'border-color 0.2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          🎙️ غرفة الصوت
          <span style={{
            fontSize: '0.65rem',
            padding: '0.15rem 0.5rem',
            borderRadius: '999px',
            background: isConnected ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)',
            color: isConnected ? '#4ade80' : 'var(--text-muted)',
            fontWeight: 600,
          }}>
            {isConnected ? '● متصل' : '○ جاري الاتصال...'}
          </span>
        </h3>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          اضغط مع الاستمرار للكلام
        </span>
      </div>

      {/* Error */}
      {micError && (
        <div style={{
          padding: '0.5rem 0.75rem',
          background: 'rgba(248,113,113,0.1)',
          border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.82rem',
          color: '#f87171',
          marginBottom: '1rem',
        }}>
          ⚠️ {micError}
        </div>
      )}

      {/* Active Speakers */}
      {activeSpeakers.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {activeSpeakers.map((speakerId) => (
            <span key={speakerId} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.25rem 0.65rem',
              background: 'rgba(74,222,128,0.12)',
              border: '1px solid rgba(74,222,128,0.3)',
              borderRadius: '999px',
              fontSize: '0.78rem',
              color: '#4ade80',
              fontWeight: 600,
              animation: 'pulse 1.5s infinite',
            }}>
              🔊 {getSpeakerName(speakerId)}
            </span>
          ))}
        </div>
      )}

      {/* Push-to-Talk Button */}
      <button
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          width: '100%',
          padding: '0.9rem',
          borderRadius: 'var(--radius-md)',
          border: `2px solid ${isTalking ? '#4ade80' : 'rgba(99,102,241,0.4)'}`,
          background: isTalking
            ? 'rgba(74,222,128,0.15)'
            : 'rgba(99,102,241,0.08)',
          color: isTalking ? '#4ade80' : 'var(--text-main)',
          fontSize: '0.95rem',
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none',
        }}
      >
        {isTalking ? (
          <>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 1s infinite' }} />
            جاري البث... (اترك الزرار للإيقاف)
          </>
        ) : (
          <>
            🎙️ اضغط مع الاستمرار للكلام
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginRight: '0.25rem' }}>(أو Space)</span>
          </>
        )}
      </button>
    </div>
  );
}
