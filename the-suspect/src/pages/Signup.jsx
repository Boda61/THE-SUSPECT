import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    document.title = 'إنشاء حساب | The Suspect';
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const handleSignup = async (e) => {
    e.preventDefault();
    if (loading) return;

    const trimmedUsername = username.trim();
    if (trimmedUsername.length < 2) {
      setError('اسم العميل يجب أن يكون على الأقل حرفين.');
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور يجب أن تكون على الأقل 6 أحرف.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Check username availability before signup.
      // Uses a SECURITY DEFINER RPC that bypasses RLS safely.
      const { data: isTaken, error: checkError } = await supabase
        .rpc('username_exists', { username: trimmedUsername });

      if (checkError) {
        setError('تعذّر التحقق من الاسم. حاول مرة أخرى.');
        return;
      }

      if (isTaken) {
        setError('هذا الاسم مأخوذ بالفعل. اختر اسمًا آخر.');
        return;
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { username: trimmedUsername },
        },
      });

      if (authError) {
        const friendlyMessages = {
          'User already registered': 'يوجد حساب مسجّل بهذا البريد الإلكتروني بالفعل.',
          // Race condition: two signups with same username hit DB simultaneously
          'Database error saving new user': 'هذا الاسم مأخوذ بالفعل. اختر اسمًا آخر.',
        };
        setError(friendlyMessages[authError.message] || 'حدث خطأ أثناء إنشاء الحساب. حاول مرة أخرى.');
        return;
      }

      // Email confirmation is disabled — signup always returns a session immediately.
      // Profile is created automatically by the database trigger on auth.users.
      if (data.session) {
        navigate('/', { replace: true });
        return;
      }

      // Fallback: should not happen when email confirmation is disabled
      setError('فشل إنشاء الحساب. حاول مرة أخرى.');
    } catch {
      setError('حدث خطأ غير متوقع. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-brand">
        <div className="auth-logo">المشتبه به</div>
        <p className="auth-tagline">اكشف الحقيقة. لا تثق بأحد.</p>
      </div>

      <div className="glass-card">
        <div className="card-header">
          <h1 className="card-title">انضم إلى التحقيق</h1>
          <p className="card-subtitle">أنشئ ملفك كمحقق</p>
        </div>

        <form onSubmit={handleSignup} noValidate>
          <div className="form-group">
            <label htmlFor="signup-username">اسم العميل</label>
            <input
              id="signup-username"
              type="text"
              className="input-field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="مثال: DetectiveX"
              minLength={2}
              autoComplete="username"
              dir="ltr"
            />
          </div>

          <div className="form-group">
            <label htmlFor="signup-email">البريد الإلكتروني</label>
            <input
              id="signup-email"
              type="email"
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="agent@suspect.com"
              autoComplete="email"
              dir="ltr"
            />
          </div>

          <div className="form-group">
            <label htmlFor="signup-password">كلمة المرور</label>
            <input
              id="signup-password"
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="6 أحرف على الأقل"
              minLength={6}
              autoComplete="new-password"
              dir="ltr"
            />
          </div>

          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !email || !password || !username}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="btn-spinner"></span>
                جاري إنشاء الحساب...
              </span>
            ) : (
              'إنشاء حساب'
            )}
          </button>
        </form>

        <p className="auth-footer-text">
          لديك حساب بالفعل؟{' '}
          <Link to="/login" className="auth-link">
            سجّل الدخول هنا
          </Link>
        </p>
      </div>
    </div>
  );
}
