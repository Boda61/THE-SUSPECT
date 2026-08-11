import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [joinError, setJoinError] = useState(null);

  useEffect(() => {
    document.title = 'The Suspect | مقر التحقيق';
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fetchProfile = async () => {
      setProfileLoading(true);
      try {
        const { data } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .single();
        if (!cancelled && data) setProfile(data);
      } catch (err) {
        console.error('[fetchProfile]', err);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };

    fetchProfile();
    return () => { cancelled = true; };
  }, [user]);

  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const array = new Uint8Array(6);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => chars[byte % chars.length]).join('');
  };

  const handleCreateRoom = async () => {
    if (createLoading) return;
    setCreateError(null);
    setCreateLoading(true);

    try {
      const code = generateCode();
      const displayName = profile?.username || user?.email?.split('@')[0] || 'محقق';

      const { data: roomId, error: rpcError } = await supabase.rpc('create_room', {
        p_code: code,
        p_display_name: displayName,
      });

      if (rpcError) {
        setCreateError('تعذّر إنشاء الغرفة. حاول مرة أخرى.');
        console.error('[create_room]', rpcError);
      } else if (roomId) {
        navigate(`/room/${roomId}`);
      }
    } catch (err) {
      setCreateError('حدث خطأ غير متوقع. حاول مرة أخرى.');
      console.error('[create_room exception]', err);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (joinLoading || !roomCodeInput.trim()) return;
    setJoinError(null);
    setJoinLoading(true);

    try {
      const code = roomCodeInput.trim().toUpperCase();
      const displayName = profile?.username || user?.email?.split('@')[0] || 'محقق';

      const { data: roomId, error: rpcError } = await supabase.rpc('join_room', {
        p_code: code,
        p_display_name: displayName,
      });

      if (rpcError) {
        const friendlyErrors = {
          'Room not found': 'الغرفة غير موجودة. تحقق من الكود وحاول مرة أخرى.',
          'Room is full': 'الغرفة ممتلئة.',
          'Room is not open': 'هذه الغرفة لم تعد تقبل لاعبين.',
          'Already in room': 'أنت بالفعل في هذه الغرفة.',
        };
        const msg = Object.keys(friendlyErrors).find((k) =>
          rpcError.message?.includes(k)
        );
        setJoinError(msg ? friendlyErrors[msg] : 'فشل الانضمام للغرفة. تحقق من الكود وحاول مرة أخرى.');
        console.error('[join_room]', rpcError);
      } else if (roomId) {
        navigate(`/room/${roomId}`);
      }
    } catch (err) {
      setJoinError('حدث خطأ غير متوقع أثناء الانضمام. حاول مرة أخرى.');
      console.error('[join_room exception]', err);
    } finally {
      setJoinLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const displayName = profileLoading
    ? '...'
    : profile?.username || user?.email?.split('@')[0] || 'عميل';

  const [showHowToPlay, setShowHowToPlay] = useState(false);

  return (
    <div className="page-wrapper">
      <header className="app-header">
        <div className="logo">The Suspect </div>
        <div className="header-right">
          <button onClick={() => setShowHowToPlay(true)} className="btn btn-ghost btn-sm">
            📖 طريقة اللعب
          </button>
          <span className="header-greeting">
            أهلاً، <strong>{displayName}</strong>
          </span>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm">
            تسجيل الخروج
          </button>
        </div>
      </header>

      <main className="home-main">
        <div className="home-hero">
          <h2 className="home-title">ابدأ تحقيقاً</h2>
          <p className="home-subtitle">
            أنشئ غرفة خاصة أو انضم لغرفة موجودة باستخدام كود الغرفة.
          </p>
        </div>

        <div className="home-grid">
          {/* Create Room Card */}
          <div className="glass-card action-card">
            <div className="action-card-icon">🔍</div>
            <h3 className="action-card-title">إنشاء غرفة</h3>
            <p className="action-card-desc">
              افتح تحقيقاً جديداً وشارك الكود مع فريقك.
            </p>
            {createError && (
              <div className="error-message" role="alert">
                {createError}
              </div>
            )}
            <button
              onClick={handleCreateRoom}
              className="btn btn-primary"
              disabled={createLoading || profileLoading}
            >
              {createLoading ? (
                <span className="btn-loading">
                  <span className="btn-spinner"></span>
                  جاري الإنشاء...
                </span>
              ) : (
                'إنشاء غرفة'
              )}
            </button>
          </div>

          {/* Join Room Card */}
          <div className="glass-card action-card">
            <div className="action-card-icon">🚪</div>
            <h3 className="action-card-title">الانضمام لغرفة</h3>
            <p className="action-card-desc">
              لديك كود؟ أدخله أدناه للانضمام لتحقيق جارٍ.
            </p>
            <form onSubmit={handleJoinRoom}>
              <div className="form-group">
                <label htmlFor="join-code" className="visually-hidden">
                  كود الغرفة
                </label>
                <input
                  id="join-code"
                  type="text"
                  className="input-field input-code"
                  value={roomCodeInput}
                  onChange={(e) =>
                    setRoomCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                  placeholder="أدخل الكود"
                  maxLength={8}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                />
              </div>
              {joinError && (
                <div className="error-message" role="alert">
                  {joinError}
                </div>
              )}
              <button
                type="submit"
                className="btn btn-secondary"
                disabled={joinLoading || !roomCodeInput.trim() || profileLoading}
              >
                {joinLoading ? (
                  <span className="btn-loading">
                    <span className="btn-spinner"></span>
                    جاري الانضمام...
                  </span>
                ) : (
                  'الانضمام'
                )}
              </button>
            </form>
          </div>
        </div>

        {/* How to Play Card Banner */}
        <div className="glass-card" style={{ marginTop: '2rem', padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>❓ كيف تلعب لعبة المشتبه به؟</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>تعرّف على القواعد وتوزيع الأدوار ونظام جمع النقاط قبل بدء الجولة.</p>
          </div>
          <button onClick={() => setShowHowToPlay(true)} className="btn btn-secondary btn-sm">
            عرض القواعد والتعليمات ←
          </button>
        </div>
      </main>

      {/* How to Play Modal */}
      {showHowToPlay && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="glass-card" style={{ maxWidth: '560px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800 }}>📖 دليل وتكيف اللعبة (How to Play)</h3>
              <button onClick={() => setShowHowToPlay(false)} className="btn btn-ghost btn-sm" aria-label="إغلاق">✖</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', fontSize: '0.925rem', lineHeight: '1.6' }}>
              <div>
                <h4 style={{ color: 'var(--primary)', fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>🕵️ 1. توزيع الأدوار السرية</h4>
                <p style={{ color: 'var(--text-muted)' }}>عند بدء الجولة، يقوم النظام بتعيين دور سرّي لكل لاعب تلقائياً. لاعب واحد يكون **المشتبه به** وباقي اللاعبين **محققون**.</p>
              </div>

              <div>
                <h4 style={{ color: 'var(--primary)', fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>🔍 2. مرحلة التحقيق والمناقشة</h4>
                <p style={{ color: 'var(--text-muted)' }}>يتم كشف ملف القضية والأدلة المكتشفة. يتناقش المحققون عبر المحادثة اللحظية لتحليل الدلائل وكشف الثغرات.</p>
              </div>

              <div>
                <h4 style={{ color: 'var(--primary)', fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>⚖️ 3. التصويت السري والاتهام</h4>
                <p style={{ color: 'var(--text-muted)' }}>يصوت كل محقق سراً على المتهم الرئيسي. بعد اكتمال التصويت، يتفق الفريق على الاتهام والوصول للحكم النهائي.</p>
              </div>

              <div>
                <h4 style={{ color: 'var(--primary)', fontSize: '1rem', fontWeight: 700, marginBottom: '0.35rem' }}>🏆 4. النتيجة وسباق النقاط</h4>
                <p style={{ color: 'var(--text-muted)' }}>إذا كشف المحققون المشتبه به، يحصلون على نقاط إضافية. وإذا نجح المشتبه به في التخفي، يحصد هو النقاط الكاملة وترتفع مرتبته في جدول الترتيب التراكمي!</p>
              </div>
            </div>

            <div style={{ marginTop: '1.75rem', textAlign: 'center' }}>
              <button onClick={() => setShowHowToPlay(false)} className="btn btn-primary" style={{ width: '100%' }}>
                فهمت، لنبدأ التحقيق! 🔍
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
