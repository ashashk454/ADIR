import React from 'react';
import { Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase.js';

export default function AppLayout({ user, children }) {
  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">Goal Planner</div>
        <nav className="nav-links">
          <Link to="/goals">Goals</Link>
        </nav>
        <div className="user-meta">
          <span className="muted">{user.email}</span>
          <button className="ghost" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </div>
      {children}
    </div>
  );
}
