import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isSuperAdmin: boolean;
  isMfaVerified: boolean;
  loading: boolean;
  signInPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  sendEmailOtp: (userId: string, email: string) => Promise<{ error: string | null }>;
  verifyEmailOtp: (userId: string, code: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMfaVerified, setIsMfaVerified] = useState<boolean>(() => {
    return sessionStorage.getItem('superadmin_mfa_verified') === 'true';
  });

  const isSuperAdmin =
    user?.app_metadata?.is_super_admin === true ||
    user?.app_metadata?.is_super_admin === 'true';

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (!s) {
          setIsMfaVerified(false);
          sessionStorage.removeItem('superadmin_mfa_verified');
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signInPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const sendEmailOtp = useCallback(async (userId: string, email: string) => {
    const { error } = await supabase.functions.invoke('send-otp', {
      body: { userId, email },
    });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const verifyEmailOtp = useCallback(async (userId: string, code: string) => {
    const { data, error } = await supabase.functions.invoke('verify-otp', {
      body: { userId, code },
    });
    if (error) return { error: error.message };
    if (data && data.success === false) {
      return { error: data.error || 'Invalid or expired verification code' };
    }

    setIsMfaVerified(true);
    sessionStorage.setItem('superadmin_mfa_verified', 'true');
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setIsMfaVerified(false);
    sessionStorage.removeItem('superadmin_mfa_verified');
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, isSuperAdmin, isMfaVerified, loading, signInPassword, sendEmailOtp, verifyEmailOtp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
