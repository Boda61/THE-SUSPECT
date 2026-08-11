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
      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .single();
      if (!cancelled && data) setProfile(data);
      if (!cancelled) setProfileLoading(false);
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

    const code = generateCode();
    const displayName = profile?.username || user?.email?.split('@')[0] || 'محقق';

    const { data: roomId, error: rpcError } = await supabase.rpc('create_room', {
      p_code: code,
      p_display_name: displayName,
    });

    setCreateLoading(false);

    if (rpcError) {
      setCreateError('تعذّر إنشاء الغرفة. حاول مرة أخرى.');
      console.error('[create_room]', rpcError);
    } else if (roomId) {
      navigate(`/room/${roomId}`);
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    if (joinLoading || !roomCodeInput.trim()) return;
    setJoinError(null);
    setJoinLoading(true);

    const code = roomCodeInput.trim().toUpperCase();
    const displayName = profile?.username || user?.email?.split('@')[0] || 'محقق';

    const { data: roomId, error: rpcError } = await supabase.rpc('join_room', {
      p_code: code,
      p_display_name: displayName,
    });

    setJoinLoading(false);

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
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const displayName = profileLoading
    ? '...'
    : profile?.username || user?.email?.split('@')[0] || 'عميل';

  return (
    <div className="page-wrapper">
      <header className="app-header">
        <div className="logo">The Suspect </div>
        <div className="header-right">
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
      </main>
    </div>
  );
}
