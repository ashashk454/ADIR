import React, { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, hasConfig } from './firebase.js';
import AuthPanel from './components/AuthPanel.jsx';
import AppLayout from './components/AppLayout.jsx';
import GoalsPage from './components/GoalsPage.jsx';
import GoalPage from './components/GoalPage.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (current) => {
      setUser(current);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  if (!hasConfig) {
    return <AuthPanel />;
  }

  if (!authReady) {
    return (
      <div className="shell">
        <div className="panel">
          <p className="muted">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPanel />;
  }

  return (
    <BrowserRouter>
      <AppLayout user={user}>
        <Routes>
          <Route path="/" element={<Navigate to="/goals" replace />} />
          <Route path="/goals" element={<GoalsPage user={user} />} />
          <Route path="/goal/:id" element={<GoalPage user={user} />} />
          <Route path="*" element={<Navigate to="/goals" replace />} />
        </Routes>
      </AppLayout>
    </BrowserRouter>
  );
}
