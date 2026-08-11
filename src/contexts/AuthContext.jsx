import { createContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import CinematicLoader from '../components/CinematicLoader';

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext({ user: null, loading: true });

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {showIntro && (
        <CinematicLoader
          isAppReady={!loading}
          onDone={() => setShowIntro(false)}
        />
      )}
      {children}
    </AuthContext.Provider>
  );
};


