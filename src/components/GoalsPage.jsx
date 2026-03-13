import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase.js';
import { buildDefaultGoal } from '../utils/goalUtils.js';
import { createGoal, deleteGoal, subscribeGoals, updateGoalMeta } from '../services/goalService.js';

export default function GoalsPage({ user }) {
  const navigate = useNavigate();
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  useEffect(() => {
    if (!db || !user) return;
    const unsub = subscribeGoals(db, user, (items) => {
      setGoals(items);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  const handleCreateGoal = async () => {
    if (!db || !user) return;
    const payload = buildDefaultGoal(newTitle || 'Untitled Goal', newDesc || '');
    const docRef = await createGoal(db, user, payload);
    setNewTitle('');
    setNewDesc('');
    navigate(`/goal/${docRef.id}`);
  };

  const startEdit = (goal) => {
    setEditingId(goal.id);
    setEditTitle(goal.title || '');
    setEditDesc(goal.description || '');
  };

  const saveEdit = async () => {
    if (!db || !user || !editingId) return;
    await updateGoalMeta(db, user, editingId, {
      title: editTitle,
      description: editDesc
    });
    setEditingId(null);
  };

  const removeGoal = async (goalId) => {
    if (!db || !user) return;
    await deleteGoal(db, user, goalId);
  };

  return (
    <div className="panel">
      <div className="section-title">
        <h3>Your Goals</h3>
        <span className="muted">Create, edit, and open any goal.</span>
      </div>

      <div className="goal-create">
        <input
          type="text"
          placeholder="Goal title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <input
          type="text"
          placeholder="Description (optional)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
        />
        <button onClick={handleCreateGoal}>Create Goal</button>
      </div>

      {loading ? (
        <p className="muted">Loading goals...</p>
      ) : (
        <div className="goals-grid">
          {goals.map((goal) => (
            <div className="goal-card" key={goal.id}>
              {editingId === goal.id ? (
                <div className="edit-block">
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                  <div className="card-actions">
                    <button onClick={saveEdit}>Save</button>
                    <button className="ghost" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <h4>{goal.title || 'Untitled Goal'}</h4>
                  <p className="muted">{goal.description || 'No description yet.'}</p>
                  <div className="card-actions">
                    <button onClick={() => navigate(`/goal/${goal.id}`)}>Open</button>
                    <button className="ghost" onClick={() => startEdit(goal)}>Edit</button>
                    <button className="ghost danger" onClick={() => removeGoal(goal.id)}>Delete</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
