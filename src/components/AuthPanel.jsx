import React, { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import { auth, googleProvider, hasConfig } from '../firebase.js';

export default function AuthPanel() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    }
  };

  const handleGoogle = async () => {
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(err.message || 'Google sign in failed.');
    }
  };

  if (!hasConfig) {
    return (
      <div className="shell">
        <div className="panel auth-card">
          <h3>Firebase Setup Needed</h3>
          <p className="muted">Add your Firebase config values in `.env` using the VITE_ variables and restart the dev server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell auth-shell">
      <div className="panel auth-card">
        <h3>{mode === 'signin' ? 'Sign In' : 'Create Account'}</h3>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <div className="error-text">{error}</div>}
          <button type="submit">{mode === 'signin' ? 'Sign In' : 'Create Account'}</button>
        </form>
        <button className="ghost" onClick={handleGoogle}>Continue with Google</button>
        <button className="link-btn" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
