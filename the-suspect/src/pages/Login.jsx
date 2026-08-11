import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    document.title = 'The Suspect | تسجيل الدخول';
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) {
        const friendlyMessages = {
          'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة. حاول مرة أخرى.',
          'Email not confirmed': 'يرجى تأكيد بريدك الإلكتروني قبل تسجيل الدخول.',
        };
        setError(friendlyMessages[authError.message] || 'حدث خطأ أثناء تسجيل الدخول. حاول مرة أخرى.');
        return;
      }

      navigate('/', { replace: true });
    } catch {
      setError('حدث خطأ غير متوقع. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-brand">
        <div className="auth-logo">The Suspect</div>
        <p className="auth-tagline">اكشف الحقيقة. لا تثق بأحد.</p>
      </div>

      <div className="glass-card">
        <div className="card-header">
          <h1 className="card-title"> مرحبًا بعودتك، المحقق</h1>
          <p className="card-subtitle">سجّل دخولك للمتابعة</p>
        </div>

        <form onSubmit={handleLogin} noValidate>
          <div className="form-group">
            <label htmlFor="login-email">البريد الإلكتروني</label>
            <input
              id="login-email"
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
            <label htmlFor="login-password">كلمة المرور</label>
            <input
              id="login-password"
              type="password"
              className="input-field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              autoComplete="current-password"
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
            disabled={loading || !email || !password}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="btn-spinner"></span>
                جاري تسجيل الدخول...
              </span>
            ) : (
              'تسجيل الدخول'
            )}
          </button>
        </form>

        <p className="auth-footer-text">
          ليس لديك حساب؟{' '}
          <Link to="/signup" className="auth-link">
            أنشئ حسابًا هنا
          </Link>
        </p>
      </div>
    </div>
  );
}
