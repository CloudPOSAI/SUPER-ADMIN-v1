import { useState, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import './LoginPage.css';

export default function LoginPage() {
  const { signInPassword, sendEmailOtp, verifyEmailOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  // Countdown timer for resend OTP
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer((t) => t - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // 1. Verify password credentials
    const result = await signInPassword(email, password);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    // 2. Trigger Email OTP 2FA challenge
    setSendingOtp(true);
    const otpRes = await sendEmailOtp(email);
    setSendingOtp(false);

    if (otpRes.error) {
      setError(`Failed to send 2FA security code: ${otpRes.error}`);
    } else {
      setStep('otp');
      setResendTimer(60);
    }
    setLoading(false);
  };

  const handleOtpSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (otpCode.length !== 6) {
      setError('Please enter a 6-digit verification code.');
      return;
    }

    setError('');
    setLoading(true);

    const result = await verifyEmailOtp(email, otpCode.trim());
    if (result.error) {
      setError(result.error || 'Invalid or expired 2FA code');
    }
    setLoading(false);
  };

  const handleResendOtp = async () => {
    if (resendTimer > 0) return;
    setError('');
    setSendingOtp(true);
    const res = await sendEmailOtp(email);
    setSendingOtp(false);
    if (res.error) {
      setError(`Failed to resend code: ${res.error}`);
    } else {
      setResendTimer(60);
    }
  };

  return (
    <div className="login-page">
      {/* Animated background elements */}
      <div className="login-bg-orb login-bg-orb-1" />
      <div className="login-bg-orb login-bg-orb-2" />
      <div className="login-bg-orb login-bg-orb-3" />

      <div className="login-container glass-card">
        <div className="login-header">
          <div className="login-logo">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="40" height="40" rx="10" fill="url(#logo-gradient)" />
              <path d="M12 20L18 26L28 14" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <defs>
                <linearGradient id="logo-gradient" x1="0" y1="0" x2="40" y2="40">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className="login-title">Super Admin</h1>
          <p className="login-subtitle">
            {step === 'password' ? 'CloudPOS Tenant Management Portal' : '2FA Security Verification'}
          </p>
        </div>

        {step === 'password' ? (
          <form className="login-form" onSubmit={handlePasswordSubmit} id="login-form">
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">Email Address</label>
              <input
                id="login-email"
                className={`form-input ${error ? 'error' : ''}`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@cloudpos.io"
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                className={`form-input ${error ? 'error' : ''}`}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && <div className="form-error login-error">{error}</div>}

            <button
              id="login-submit"
              type="submit"
              className="btn btn-primary btn-lg login-button"
              disabled={loading || sendingOtp || !email || !password}
            >
              {loading || sendingOtp ? <span className="spinner" /> : null}
              {sendingOtp ? 'Sending 2FA Code...' : loading ? 'Validating...' : 'Continue'}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleOtpSubmit} id="otp-form">
            <div className="otp-info-banner">
              📩 A 6-digit security code has been sent to <strong>{email}</strong>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="otp-code">Enter 6-Digit Code</label>
              <input
                id="otp-code"
                className={`form-input otp-input ${error ? 'error' : ''}`}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                required
                autoFocus
              />
            </div>

            {error && <div className="form-error login-error">{error}</div>}

            <button
              id="otp-submit"
              type="submit"
              className="btn btn-primary btn-lg login-button"
              disabled={loading || otpCode.length !== 6}
            >
              {loading ? <span className="spinner" /> : null}
              {loading ? 'Verifying Code...' : 'Verify & Sign In'}
            </button>

            <div className="otp-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleResendOtp}
                disabled={resendTimer > 0 || sendingOtp}
              >
                {sendingOtp ? 'Sending...' : resendTimer > 0 ? `Resend Code in ${resendTimer}s` : '🔄 Resend Code'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { setStep('password'); setError(''); setOtpCode(''); }}
              >
                ← Back
              </button>
            </div>
          </form>
        )}

        <p className="login-footer">
          Restricted to authorized Super Admin accounts only.
        </p>
      </div>
    </div>
  );
}
