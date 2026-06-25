import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('landing');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Email/password form
  const [emailForm, setEmailForm] = useState({ email: '', password: '' });
  // Signup form
  const [signupForm, setSignupForm] = useState({ name: '', email: '', password: '', confirm: '', role: 'Compliance Analyst' });
  // Phone OTP form
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  const resetState = () => {
    setError('');
    setInfo('');
    setLoading(false);
  };

  // ── Google OAuth ─────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // On success, Supabase redirects browser — App.jsx onAuthStateChange handles it
  };

  // ── Email Sign In ────────────────────────────────────────────
  const handleEmailSignIn = async (e) => {
    e.preventDefault();
    setError('');
    if (!emailForm.email || !emailForm.password) { setError('Please enter email and password.'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailForm.email,
      password: emailForm.password,
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    const user = data.user;
    onLogin({
      name: user.user_metadata?.full_name || user.email.split('@')[0],
      email: user.email,
      avatar: (user.user_metadata?.full_name || user.email).slice(0, 2).toUpperCase(),
      role: user.user_metadata?.role || 'Compliance Analyst',
      provider: 'email',
    });
  };

  // ── Email Sign Up ────────────────────────────────────────────
  const handleEmailSignUp = async (e) => {
    e.preventDefault();
    setError('');
    if (!signupForm.name || !signupForm.email || !signupForm.password || !signupForm.confirm) {
      setError('Please fill in all fields.'); return;
    }
    if (signupForm.password !== signupForm.confirm) { setError('Passwords do not match.'); return; }
    if (signupForm.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: signupForm.email,
      password: signupForm.password,
      options: {
        data: {
          full_name: signupForm.name,
          role: signupForm.role,
        },
      },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    // If email confirmation is required
    if (data.user && !data.session) {
      setInfo('✅ Confirmation email sent! Please check your inbox and verify your email, then sign in.');
      setMode('email-login');
      return;
    }
    // Immediately logged in (email confirm disabled)
    const user = data.user;
    onLogin({
      name: signupForm.name,
      email: user.email,
      avatar: signupForm.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
      role: signupForm.role,
      provider: 'email',
    });
  };

  // ── Phone — Send OTP ─────────────────────────────────────────
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    if (!phone || phone.length < 10) { setError('Enter a valid phone number with country code (e.g. +919876543210).'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setOtpSent(true);
    setInfo(`OTP sent to ${phone}. Please check your SMS.`);
  };

  // ── Phone — Verify OTP ────────────────────────────────────────
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError('');
    if (!otp || otp.length < 4) { setError('Please enter the OTP you received.'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: 'sms',
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    const user = data.user;
    onLogin({
      name: user.user_metadata?.full_name || user.phone,
      email: user.email || user.phone,
      avatar: (user.phone || 'PH').slice(-2),
      role: 'Compliance Analyst',
      provider: 'phone',
    });
  };

  return (
    <div className="login-root">
      <div className="login-blob login-blob-1"/>
      <div className="login-blob login-blob-2"/>
      <div className="login-blob login-blob-3"/>

      <div className="login-card">
        {/* Brand Header */}
        <div className="login-brand">
          <div className="login-logo">
            <svg width="50" height="50" viewBox="0 0 50 50" fill="none">
              <polygon points="25,3 46,14 46,36 25,47 4,36 4,14" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.3)" strokeWidth="1"/>
              <polygon points="25,9 40,17.5 40,32.5 25,41 10,32.5 10,17.5" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth="1"/>
              <text x="25" y="30" textAnchor="middle" fill="white" fontSize="10" fontWeight="800" letterSpacing="0.5">DOW</text>
            </svg>
          </div>
          <div>
            <h1 className="login-title">Dow Chemical</h1>
            <p className="login-subtitle">Supplier SDS/MSDS Compliance Management System</p>
          </div>
        </div>

        {/* ── LANDING ── */}
        {mode === 'landing' && (
          <div className="login-body">
            <p className="login-welcome">Secure access to the Dow Chemical Supplier Compliance Portal. Sign in to continue.</p>

            {/* Google */}
            <button className="btn-google" id="btn-google-signin" onClick={handleGoogleSignIn} disabled={loading}>
              <svg className="google-icon" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
              </svg>
              {loading ? <span className="spinner-sm"/> : 'Continue with Google'}
            </button>

            <button className="btn-phone" id="btn-phone-signin" onClick={() => { setMode('phone'); resetState(); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:'8px'}}>
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.56a16 16 0 0 0 6 6l.87-.87a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              Continue with Phone (OTP)
            </button>

            <div className="login-divider"><span>or</span></div>

            <button className="btn-login-email" id="btn-email-signin" onClick={() => { setMode('email-login'); resetState(); }}>
              Sign in with Email
            </button>

            <p className="login-register-prompt">
              New user?{' '}
              <button className="link-btn" onClick={() => { setMode('signup'); resetState(); }}>Create an account</button>
            </p>
          </div>
        )}

        {/* ── PHONE OTP ── */}
        {mode === 'phone' && (
          <div className="login-body">
            <button className="back-btn" onClick={() => { setMode('landing'); setOtpSent(false); setOtp(''); setPhone(''); resetState(); }}>← Back</button>
            <h2 className="login-form-title">Phone Sign In</h2>
            <p className="login-form-sub">We'll send a one-time password to your mobile number</p>

            {!otpSent ? (
              <form className="login-form" onSubmit={handleSendOtp} id="form-phone-otp">
                <div className="form-group">
                  <label htmlFor="phone-input">Phone Number (with country code)</label>
                  <input
                    id="phone-input"
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    autoComplete="tel"
                  />
                  <span className="form-hint">Include country code, e.g. +91 for India, +1 for US</span>
                </div>
                {error && <div className="login-error">{error}</div>}
                <button type="submit" className="btn-submit" disabled={loading} id="btn-send-otp">
                  {loading ? <span className="spinner-sm"/> : 'Send OTP →'}
                </button>
              </form>
            ) : (
              <form className="login-form" onSubmit={handleVerifyOtp} id="form-verify-otp">
                {info && <div className="login-info">{info}</div>}
                <div className="form-group">
                  <label htmlFor="otp-input">Enter 6-digit OTP</label>
                  <input
                    id="otp-input"
                    type="text"
                    placeholder="123456"
                    value={otp}
                    maxLength={6}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    autoComplete="one-time-code"
                    style={{letterSpacing:'0.3em', fontSize:'1.3rem', textAlign:'center'}}
                  />
                </div>
                {error && <div className="login-error">{error}</div>}
                <button type="submit" className="btn-submit" disabled={loading} id="btn-verify-otp">
                  {loading ? <span className="spinner-sm"/> : 'Verify & Sign In →'}
                </button>
                <button type="button" className="link-btn" style={{marginTop:'12px', display:'block', textAlign:'center'}} onClick={() => { setOtpSent(false); setOtp(''); setInfo(''); setError(''); }}>
                  Resend OTP
                </button>
              </form>
            )}
          </div>
        )}

        {/* ── EMAIL LOGIN ── */}
        {mode === 'email-login' && (
          <div className="login-body">
            <button className="back-btn" onClick={() => { setMode('landing'); resetState(); }}>← Back</button>
            <h2 className="login-form-title">Sign In</h2>
            <p className="login-form-sub">Enter your Dow Chemical credentials</p>
            {info && <div className="login-info">{info}</div>}
            <form className="login-form" onSubmit={handleEmailSignIn} id="form-email-login">
              <div className="form-group">
                <label htmlFor="el-email">Email Address</label>
                <input id="el-email" type="email" placeholder="you@company.com" value={emailForm.email} onChange={e => setEmailForm(p => ({ ...p, email: e.target.value }))} autoComplete="email"/>
              </div>
              <div className="form-group">
                <label htmlFor="el-password">Password</label>
                <input id="el-password" type="password" placeholder="••••••••" value={emailForm.password} onChange={e => setEmailForm(p => ({ ...p, password: e.target.value }))} autoComplete="current-password"/>
              </div>
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="btn-submit" disabled={loading} id="btn-submit-email-login">
                {loading ? <span className="spinner-sm"/> : 'Sign In →'}
              </button>
            </form>
            <p className="login-register-prompt">
              Don't have an account?{' '}
              <button className="link-btn" onClick={() => { setMode('signup'); resetState(); }}>Create one</button>
            </p>
          </div>
        )}

        {/* ── SIGN UP ── */}
        {mode === 'signup' && (
          <div className="login-body">
            <button className="back-btn" onClick={() => { setMode('landing'); resetState(); }}>← Back</button>
            <h2 className="login-form-title">Create Account</h2>
            <p className="login-form-sub">Register your Dow Chemical compliance portal account</p>
            <form className="login-form" onSubmit={handleEmailSignUp} id="form-signup">
              <div className="form-group">
                <label htmlFor="su-name">Full Name</label>
                <input id="su-name" type="text" placeholder="John Williams" value={signupForm.name} onChange={e => setSignupForm(p => ({ ...p, name: e.target.value }))}/>
              </div>
              <div className="form-group">
                <label htmlFor="su-email">Work Email</label>
                <input id="su-email" type="email" placeholder="you@company.com" value={signupForm.email} onChange={e => setSignupForm(p => ({ ...p, email: e.target.value }))}/>
              </div>
              <div className="form-group">
                <label htmlFor="su-role">Role</label>
                <select id="su-role" value={signupForm.role} onChange={e => setSignupForm(p => ({ ...p, role: e.target.value }))}>
                  <option>Compliance Analyst</option>
                  <option>Supplier Compliance Manager</option>
                  <option>Product Safety Officer</option>
                  <option>Regulatory Affairs Director</option>
                  <option>EHS Coordinator</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="su-password">Password</label>
                <input id="su-password" type="password" placeholder="Min. 6 characters" value={signupForm.password} onChange={e => setSignupForm(p => ({ ...p, password: e.target.value }))}/>
              </div>
              <div className="form-group">
                <label htmlFor="su-confirm">Confirm Password</label>
                <input id="su-confirm" type="password" placeholder="Repeat password" value={signupForm.confirm} onChange={e => setSignupForm(p => ({ ...p, confirm: e.target.value }))}/>
              </div>
              {error && <div className="login-error">{error}</div>}
              <button type="submit" className="btn-submit" disabled={loading} id="btn-submit-signup">
                {loading ? <span className="spinner-sm"/> : 'Create Account →'}
              </button>
            </form>
          </div>
        )}

        <footer className="login-footer">
          <span>© {new Date().getFullYear()} Dow Chemical · Global Supplier Compliance · Product Safety & Regulatory Affairs</span>
        </footer>
      </div>
    </div>
  );
}
