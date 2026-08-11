import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught an error]:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-wrapper">
          <header className="app-header">
            <div className="logo">المشتبه به</div>
          </header>
          <main className="error-page">
            <div className="glass-card error-card">
              <div className="error-icon">⚠️</div>
              <h2>حدث خطأ في النظام</h2>
              <p>واجهنا مشكلة غير متوقعة. يرجى تحديث الصفحة للمحاولة مجدداً.</p>
              <button onClick={this.handleReload} className="btn btn-primary">
                إعادة تحميل التطبيق
              </button>
            </div>
          </main>
        </div>
      );
    }

    return this.props.children;
  }
}
