import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function NotFound() {
  useEffect(() => {
    document.title = '404 - الصفحة غير موجودة | The Suspect';
  }, []);

  return (
    <div className="page-wrapper">
      <header className="app-header">
        <div className="logo">The Suspect</div>
      </header>
      <main className="error-page">
        <div className="glass-card error-card">
          <div className="error-icon">🕵️‍♂️</div>
          <h1 className="card-title">404 - الصفحة غير موجودة</h1>
          <p>الصفحة أو غرفة التحقيق التي تبحث عنها غير موجودة أو تم تصنيفها كسرّية.</p>
          <Link to="/" className="btn btn-primary" style={{ display: 'inline-flex', marginTop: '1rem' }}>
            العودة إلى مقر التحقيق
          </Link>
        </div>
      </main>
    </div>
  );
}
