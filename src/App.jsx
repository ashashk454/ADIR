import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import { auth, db, googleProvider, hasConfig } from './firebase.js';

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatDate = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};
const displayDate = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const createRow = () => ({ id: makeId(), step: '', requirements: '', challenges: '', time: 1, notes: '' });

const buildDefaultGoal = (title = 'New Goal', description = '') => {
  const firstOptionId = makeId();
  return {
    title,
    description,
    options: [{ id: firstOptionId, title: 'Option 1', rows: [createRow(), createRow()] }],
    selectedOptionId: firstOptionId,
    hoursPerDay: 2,
    workingDays: [1, 2, 3, 4, 5],
    schedule: [],
    statusByDate: {},
    taskNotes: {},
    taskStatus: {}
  };
};

const ensureOptionRowIds = (options = []) =>
  options.map((opt) => ({
    ...opt,
    rows: (opt.rows || []).map((row) => (row.id ? row : { ...row, id: makeId() }))
  }));

const normalizeSchedule = (schedule = [], options = []) =>
  schedule.map((item) => {
    if (item.stepId) return item;
    if (typeof item.stepIndex !== 'number') return item;
    const option = options.find((opt) => opt.id === item.optionId);
    const row = option?.rows?.[item.stepIndex];
    if (!row?.id) return item;
    return { ...item, stepId: row.id };
  });

const normalizeStatusByDate = (statusByDate = {}, options = []) => {
  const map = {};
  Object.entries(statusByDate || {}).forEach(([key, value]) => {
    if (!value) return;
    const [dateStr, optionId, stepKey] = key.split('|');
    if (!dateStr || !optionId || !stepKey) return;
    const option = options.find((opt) => opt.id === optionId);
    if (!option) return;
    const isIndex = /^\d+$/.test(stepKey);
    if (!isIndex) {
      map[`${dateStr}|${optionId}|${stepKey}`] = value;
      return;
    }
    const row = option.rows?.[Number(stepKey)];
    if (row?.id) {
      map[`${dateStr}|${optionId}|${row.id}`] = value;
    }
  });
  return map;
};

const normalizeKeyedMap = (input = {}, options = []) => {
  const output = {};
  Object.entries(input || {}).forEach(([key, value]) => {
    const [optionId, stepKey] = key.split('-');
    const option = options.find((opt) => opt.id === optionId);
    if (!option) return;
    const isIndex = /^\d+$/.test(stepKey);
    if (!isIndex) {
      output[key] = value;
      return;
    }
    const row = option.rows?.[Number(stepKey)];
    if (row?.id) {
      output[`${optionId}-${row.id}`] = value;
    }
  });
  return output;
};

const buildTaskStatusForSave = (options = [], taskStatus = {}) => {
  const next = { ...taskStatus };
  options.forEach((opt) => {
    (opt.rows || []).forEach((row) => {
      const key = `${opt.id}-${row.id}`;
      if (!(key in next)) {
        next[key] = null;
      }
    });
  });
  return next;
};

const nextWorkingDate = (date, workingDays) => {
  const d = new Date(date);
  while (!workingDays.includes(d.getDay())) d.setDate(d.getDate() + 1);
  return d;
};

const buildSchedule = (option, hoursPerDay, workingDays, startDate, progress = {}) => {
  const schedule = [];
  const capacityPerDay = {};
  const date = new Date(startDate);
  const totals = option.rows.map((r) => Math.max(0, parseFloat(r.time) || 0));
  const doneMap = Array.isArray(progress) ? {} : progress;
  const doneArr = Array.isArray(progress) ? progress : null;
  for (let stepIdx = 0; stepIdx < option.rows.length; stepIdx += 1) {
    const row = option.rows[stepIdx];
    const done = doneMap[row.id] ?? (doneArr ? doneArr[stepIdx] : 0);
    let remaining = Math.max(0, totals[stepIdx] - (done || 0));
    while (remaining > 0) {
      const dayKey = formatDate(date);
      if (workingDays.includes(date.getDay())) {
        if (!(dayKey in capacityPerDay)) capacityPerDay[dayKey] = hoursPerDay;
        const free = capacityPerDay[dayKey];
        if (free <= 0) {
          date.setDate(date.getDate() + 1);
          continue;
        }
        const chunk = Math.min(remaining, free);
        schedule.push({ date: dayKey, stepId: row.id, hours: chunk, optionId: option.id });
        capacityPerDay[dayKey] -= chunk;
        remaining -= chunk;
      } else {
        date.setDate(date.getDate() + 1);
      }
      if (!workingDays.includes(date.getDay())) continue;
      if (capacityPerDay[formatDate(date)] <= 0) date.setDate(date.getDate() + 1);
    }
    if (capacityPerDay[formatDate(date)] <= 0) date.setDate(date.getDate() + 1);
  }
  return schedule;
};

function AuthPanel() {
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

function AppLayout({ user, children }) {
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

function GoalsPage({ user }) {
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
    const goalsRef = collection(db, 'users', user.uid, 'goals');
    const q = query(goalsRef, orderBy('updatedAt', 'desc'));
    const unsub = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      setGoals(items);
      setLoading(false);
    });
    return () => unsub();
  }, [user]);

  const createGoal = async () => {
    if (!db || !user) return;
    const payload = buildDefaultGoal(newTitle || 'Untitled Goal', newDesc || '');
    const docRef = await addDoc(collection(db, 'users', user.uid, 'goals'), {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
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
    await updateDoc(doc(db, 'users', user.uid, 'goals', editingId), {
      title: editTitle,
      description: editDesc,
      updatedAt: serverTimestamp()
    });
    setEditingId(null);
  };

  const removeGoal = async (goalId) => {
    if (!db || !user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'goals', goalId));
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
        <button onClick={createGoal}>Create Goal</button>
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

function GoalPage({ user }) {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDesc, setGoalDesc] = useState('');
  const [hoursPerDay, setHoursPerDay] = useState(2);
  const [workingDays, setWorkingDays] = useState([1, 2, 3, 4, 5]);
  const [options, setOptions] = useState([]);
  const [selectedOptionId, setSelectedOptionId] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [statusByDate, setStatusByDate] = useState({});
  const [taskNotes, setTaskNotes] = useState({});
  const [taskStatus, setTaskStatus] = useState({});
  const [showCompare, setShowCompare] = useState(false);
  const saveTimer = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!db || !user || !id) return;
    const goalRef = doc(db, 'users', user.uid, 'goals', id);
    const load = async () => {
      const snap = await getDoc(goalRef);
      if (!snap.exists()) {
        const payload = buildDefaultGoal('New Goal', '');
        await setDoc(goalRef, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        setGoalTitle(payload.title);
        setGoalDesc(payload.description);
        setOptions(payload.options);
        setSelectedOptionId(payload.selectedOptionId);
        setHoursPerDay(payload.hoursPerDay);
        setWorkingDays(payload.workingDays);
        setSchedule(payload.schedule);
        setStatusByDate(payload.statusByDate);
        setTaskNotes(payload.taskNotes);
        setTaskStatus(payload.taskStatus);
      } else {
        const data = snap.data();
        const fallback = buildDefaultGoal(data.title || 'New Goal', data.description || '');
        const rawOptions = Array.isArray(data.options) && data.options.length ? data.options : fallback.options;
        const normalizedOptions = ensureOptionRowIds(rawOptions);
        const normalizedSchedule = normalizeSchedule(Array.isArray(data.schedule) ? data.schedule : fallback.schedule, normalizedOptions);
        const normalizedStatusByDate = normalizeStatusByDate(data.statusByDate || fallback.statusByDate, normalizedOptions);
        const normalizeTaskStatus = (input) => {
          if (!input || typeof input !== 'object') return {};
          const next = {};
          Object.entries(input).forEach(([key, value]) => {
            if (value && typeof value === 'object' && value.status === 'done') {
              next[key] = value;
            } else if (value === 'done' || value === true) {
              next[key] = { status: 'done', completedDate: formatDate(new Date()) };
            }
          });
          return next;
        };
        const normalizedTaskNotes = normalizeKeyedMap(data.taskNotes || fallback.taskNotes, normalizedOptions);
        const normalizedTaskStatus = normalizeKeyedMap(normalizeTaskStatus(data.taskStatus || fallback.taskStatus), normalizedOptions);
        setGoalTitle(data.title ?? fallback.title);
        setGoalDesc(data.description ?? fallback.description);
        setOptions(normalizedOptions);
        setSelectedOptionId(data.selectedOptionId || normalizedOptions?.[0]?.id || fallback.selectedOptionId);
        setHoursPerDay(data.hoursPerDay ?? fallback.hoursPerDay);
        setWorkingDays(Array.isArray(data.workingDays) && data.workingDays.length ? data.workingDays : fallback.workingDays);
        setSchedule(normalizedSchedule);
        setStatusByDate(normalizedStatusByDate);
        setTaskNotes(normalizedTaskNotes);
        setTaskStatus(normalizedTaskStatus);
      }
      setLoading(false);
      setIsLoaded(true);
    };
    load();
  }, [id, user]);

  useEffect(() => {
    if (!db || !user || !id || !isLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const goalRef = doc(db, 'users', user.uid, 'goals', id);
        await setDoc(
          goalRef,
          {
            title: goalTitle,
            description: goalDesc,
            options,
            selectedOptionId,
            hoursPerDay,
            workingDays,
            schedule,
            statusByDate,
            taskNotes,
            taskStatus: buildTaskStatusForSave(options, taskStatus),
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
    }, 150);
    return () => clearTimeout(saveTimer.current);
  }, [goalTitle, goalDesc, options, selectedOptionId, hoursPerDay, workingDays, schedule, statusByDate, taskNotes, taskStatus, id, user, isLoaded]);

  const updateRow = (optionId, rowIndex, field, value) => {
    setOptions((prev) =>
      prev.map((opt) => {
        if (opt.id !== optionId) return opt;
        const rows = opt.rows.map((r, idx) =>
          idx === rowIndex ? { ...r, [field]: field === 'time' ? parseFloat(value) || 0 : value } : r
        );
        return { ...opt, rows };
      })
    );
  };

  const addOption = () => {
    setOptions((prev) => {
      const id = makeId();
      const option = { id, title: `Option ${prev.length + 1}`, rows: [createRow(), createRow()] };
      if (!selectedOptionId) setSelectedOptionId(id);
      return [...prev, option];
    });
  };

  const removeOption = (optionId) => {
    setOptions((prev) => {
      const updated = prev.filter((opt) => opt.id !== optionId);
      if (updated.length === 0) {
        const fallbackId = makeId();
        const fallback = { id: fallbackId, title: 'Option 1', rows: [createRow(), createRow()] };
        setSelectedOptionId(fallbackId);
        return [fallback];
      }
      if (selectedOptionId === optionId) {
        setSelectedOptionId(updated[0].id);
      }
      return updated;
    });
  };

  const addRow = (optionId) => {
    setOptions((prev) => prev.map((opt) => (opt.id === optionId ? { ...opt, rows: [...opt.rows, createRow()] } : opt)));
  };

  const removeRow = (optionId, rowIndex) => {
    const option = options.find((opt) => opt.id === optionId);
    const removedRowId = option?.rows?.[rowIndex]?.id;
    setOptions((prev) =>
      prev.map((opt) => {
        if (opt.id !== optionId) return opt;
        const rows = opt.rows.filter((_, idx) => idx !== rowIndex);
        return { ...opt, rows: rows.length ? rows : [createRow()] };
      })
    );
    if (removedRowId) {
      const stepKey = `${optionId}-${removedRowId}`;
      setSchedule((prev) => prev.filter((item) => !(item.optionId === optionId && item.stepId === removedRowId)));
      setStatusByDate((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((key) => {
          if (key.endsWith(`|${optionId}|${removedRowId}`)) {
            delete next[key];
          }
        });
        return next;
      });
      setTaskNotes((prev) => {
        const next = { ...prev };
        delete next[stepKey];
        return next;
      });
      setTaskStatus((prev) => {
        const next = { ...prev };
        delete next[stepKey];
        return next;
      });
    }
  };

  const workingDayToggle = (day) => {
    setWorkingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  };

  const calculateTimeline = () => {
    const option = options.find((o) => o.id === selectedOptionId);
    if (!option || hoursPerDay <= 0) return;
    const start = new Date();
    const wdays = workingDays.length ? workingDays : [1, 2, 3, 4, 5];
    const first = nextWorkingDate(start, wdays);
    const sched = buildSchedule(option, hoursPerDay, wdays, first);
    setSchedule(sched);
    setStatusByDate({});
  };

  const groupedSchedule = useMemo(() => {
    const grouped = {};
    schedule.forEach((item) => {
      if (!grouped[item.date]) grouped[item.date] = [];
      grouped[item.date].push(item);
    });
    return grouped;
  }, [schedule]);

  const totalHours = useMemo(() => schedule.reduce((s, item) => s + item.hours, 0), [schedule]);

  const timelineSummary = useMemo(() => {
    if (!schedule.length) return 'No schedule yet. Calculate after selecting an option and hours per day.';
    const last = schedule[schedule.length - 1];
    const estDate = new Date(`${last.date}T00:00:00`);
    const wdays = (workingDays.length ? workingDays : [1, 2, 3, 4, 5]).map((d) => dayLabels[d]).join(', ');
    const option = options.find((o) => o.id === selectedOptionId);
    return `${option?.title || 'Plan'} spans ${schedule.length} day-slices (${totalHours}h) ending ${displayDate(estDate)}. Working days: ${wdays}.`;
  }, [schedule, totalHours, workingDays, selectedOptionId, options]);

  const markStatus = (dateStr, status) => {
    setStatusByDate((prev) => ({ ...prev, [dateStr]: status }));
    if (status === 'missed') rescheduleFrom(dateStr);
  };

  const rescheduleFrom = (dateStr) => {
    const option = options.find((o) => o.id === selectedOptionId);
    if (!option || hoursPerDay <= 0) return;
    const wdays = workingDays.length ? workingDays : [1, 2, 3, 4, 5];
    const progress = {};
    schedule.forEach((item) => {
      if (
        item.date < dateStr &&
        statusByDate[completionKey(item.date, item.optionId, item.stepId)]
      ) {
        const stepId = item.stepId;
        if (!stepId) return;
        progress[stepId] = (progress[stepId] || 0) + item.hours;
      }
    });
    const start = nextWorkingDate(new Date(dateStr), wdays);
    const rebuilt = buildSchedule(option, hoursPerDay, wdays, start, progress);
    const kept = schedule.filter((s) => s.date < dateStr);
    setSchedule([...kept, ...rebuilt]);
    setStatusByDate((prev) => {
      const clone = { ...prev };
      Object.keys(clone).forEach((d) => {
        if (d >= dateStr) delete clone[d];
      });
      return clone;
    });
  };

  const handleTaskCheck = (key, completedDate = formatDate(new Date())) => {
    setTaskStatus((prev) => ({ ...prev, [key]: { status: 'done', completedDate } }));
  };

  const clearTaskStatus = (key) => {
    setTaskStatus((prev) => {
      return { ...prev, [key]: null };
    });
  };

  const completionKey = (dateStr, optionId, stepId) => `${dateStr}|${optionId}|${stepId}`;

  const setDateCompletion = (dateStr, optionId, stepId, completed) => {
    const key = completionKey(dateStr, optionId, stepId);
    setStatusByDate((prev) => {
      const next = { ...prev, [key]: completed ? true : false };
      const stepKey = `${optionId}-${stepId}`;
      const dates = stepDatesByIndex[stepKey] || [];
      const allDone = dates.length > 0 && dates.every((d) => next[completionKey(d, optionId, stepId)]);
      if (completed && allDone) {
        const completedDate = dates[dates.length - 1] || dateStr;
        setTaskStatus((prevStatus) => ({ ...prevStatus, [stepKey]: { status: 'done', completedDate } }));
      } else {
        clearTaskStatus(stepKey);
      }
      return next;
    });
  };

  const stepDatesByIndex = useMemo(() => {
    const map = {};
    schedule
      .filter((item) => item.optionId === selectedOptionId)
      .forEach((item) => {
        const key = `${item.optionId}-${item.stepId}`;
        if (!map[key]) map[key] = [];
        if (!map[key].includes(item.date)) map[key].push(item.date);
      });
    Object.values(map).forEach((dates) => dates.sort());
    return map;
  }, [schedule, selectedOptionId]);

  const completedDatesByStep = useMemo(() => {
    const map = {};
    Object.keys(statusByDate || {}).forEach((key) => {
      if (!statusByDate[key]) return;
      const [dateStr, optionId, stepId] = key.split('|');
      if (!dateStr || !optionId) return;
      const stepKey = `${optionId}-${stepId}`;
      if (!map[stepKey] || dateStr > map[stepKey]) {
        map[stepKey] = dateStr;
      }
    });
    return map;
  }, [statusByDate]);

  const markStepComplete = (optionId, stepId) => {
    const key = `${optionId}-${stepId}`;
    const dates = stepDatesByIndex[key] || [];
    setTaskStatus((prev) => ({ ...prev, [key]: { status: 'done', completedDate: formatDate(new Date()) } }));
    setStatusByDate((prev) => {
      const next = { ...prev };
      dates.forEach((dateStr) => {
        next[completionKey(dateStr, optionId, stepId)] = true;
      });
      return next;
    });
  };

  const markNextScheduledDate = (optionId, stepId) => {
    const key = `${optionId}-${stepId}`;
    const dates = stepDatesByIndex[key] || [];
    const nextDate = dates.find((dateStr) => !statusByDate[completionKey(dateStr, optionId, stepId)]);
    if (!nextDate) return;
    setDateCompletion(nextDate, optionId, stepId, true);
  };

  const markStepActive = (optionId, stepId) => {
    const key = `${optionId}-${stepId}`;
    const dates = stepDatesByIndex[key] || [];
    clearTaskStatus(key);
    setStatusByDate((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((entryKey) => {
        if (entryKey.endsWith(`|${optionId}|${stepId}`)) {
          next[entryKey] = false;
        }
      });
      dates.forEach((dateStr) => {
        const k = completionKey(dateStr, optionId, stepId);
        next[k] = false;
      });
      return next;
    });
  };

  const handleTaskNotes = (key, value) => {
    setTaskNotes((prev) => ({ ...prev, [key]: value }));
  };

  const [weekOffset, setWeekOffset] = useState(0);

  const weekDates = useMemo(() => {
    const today = new Date();
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + mondayOffset + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  if (loading) {
    return <div className="panel"><p className="muted">Loading goal...</p></div>;
  }

  return (
    <>
      <div className="hero">
        <div className="pill">Dark workspace - Turn goals into reality</div>
        <h1>{goalTitle || 'Untitled Goal'}</h1>
        <p>Plan, compare, and execute your selected goal.</p>
        <div className="compare-bar">
          <span className="badge">Working copy: synced</span>
        </div>
      </div>

      <div className="grid-two">
        <div className="panel">
          <h3>Define Your Goal</h3>
          <label htmlFor="goalInput">Goal</label>
          <input id="goalInput" type="text" value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} />
          <label htmlFor="goalDesc" style={{ marginTop: 10 }}>
            Description (optional)
          </label>
          <textarea id="goalDesc" value={goalDesc} onChange={(e) => setGoalDesc(e.target.value)} />
        </div>
      </div>

      <div className="panel">
        <div className="options-header">
          <div className="section-title">
            <h3>Plan Options</h3>
            <span className="muted">Create multiple approaches with editable steps.</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button id="addOption" className="ghost" onClick={addOption}>
              + Add Option
            </button>
            <button id="compareBtn" onClick={() => setShowCompare(true)}>
              Compare &amp; Choose
            </button>
          </div>
        </div>
        <div id="optionList" className="option-list">
          {options.map((option) => (
            <div className="option-card" key={option.id}>
              <div className="option-header">
                <input className="option-title" value={option.title} onChange={(e) => setOptions((prev) => prev.map((opt) => opt.id === option.id ? { ...opt, title: e.target.value } : opt))} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {selectedOptionId === option.id && (
                    <span className="pill" style={{ background: 'rgba(126,249,198,0.16)', borderColor: 'rgba(126,249,198,0.4)' }}>
                      Preferred
                    </span>
                  )}
                  <button className="small-btn ghost" onClick={() => setSelectedOptionId(option.id)}>
                    Choose
                  </button>
                  <button className="small-btn ghost danger" onClick={() => removeOption(option.id)}>
                    Delete
                  </button>
                </div>
              </div>
              <table>
                <colgroup>
                  <col style={{ width: '26%' }} />\n                  <col style={{ width: '26%' }} />\n                  <col style={{ width: '26%' }} />\n                  <col style={{ width: '12%' }} />\n                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Step</th>
                    <th>Requirements</th>
                    <th>Challenges</th>
                    <th>Estimated Time (hrs)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {option.rows.map((row, rIdx) => (
                    <tr key={`${option.id}-${rIdx}`}>
                      <td contentEditable suppressContentEditableWarning onBlur={(e) => updateRow(option.id, rIdx, 'step', e.currentTarget.textContent)}>
                        {row.step}
                      </td>
                      <td
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => updateRow(option.id, rIdx, 'requirements', e.currentTarget.textContent)}
                      >
                        {row.requirements}
                      </td>
                      <td
                        contentEditable
                        suppressContentEditableWarning
                        onBlur={(e) => updateRow(option.id, rIdx, 'challenges', e.currentTarget.textContent)}
                      >
                        {row.challenges}
                      </td>
                      <td contentEditable suppressContentEditableWarning onBlur={(e) => updateRow(option.id, rIdx, 'time', e.currentTarget.textContent)}>
                        {row.time}
                      </td>
                      <td>
                        <button className="small-btn" onClick={() => removeRow(option.id, rIdx)} aria-label="Remove step" title="Remove step">
                          <FiTrash2 />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="table-actions">
                <button className="small-btn" onClick={() => addRow(option.id)}>
                  + Add Step
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Timeline Inputs</h3>
        <div className="grid-two">
          <div>
            <label htmlFor="hoursPerDay">Hours per day</label>
            <input
              id="hoursPerDay"
              type="number"
              min="0"
              step="0.5"
              value={hoursPerDay}
              onChange={(e) => setHoursPerDay(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <label>Working days</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }}>
              {dayLabels.map((label, idx) => (
                <label key={label}>
                  <input type="checkbox" className="day-checkbox" checked={workingDays.includes(idx)} onChange={() => workingDayToggle(idx)} />{' '}
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <button id="calcTimeline" style={{ marginTop: 12, width: '100%' }} onClick={calculateTimeline}>
          Calculate Timeline
        </button>
        <p id="timelineSummary" className="muted" style={{ marginTop: 10 }}>
          {timelineSummary}
        </p>
      </div>

      <div className="panel">
        <div className="section-title">
          <h3>Calendar View</h3>
          <span className="muted">Auto-generated schedule per day</span>
        </div>
        <div className="week-controls">
          <button className="ghost" onClick={() => setWeekOffset((prev) => Math.max(prev - 1, 0))}>
            Previous Week
          </button>
          <button className="ghost" onClick={() => setWeekOffset((prev) => prev + 1)}>
            Next Week
          </button>
        </div>
        <div id="calendar" className="calendar week-calendar">
          {!schedule.length && <p className="muted">Run the calculator to see a schedule.</p>}
          {weekDates.map((dateObj) => {
            const dateStr = formatDate(dateObj);
            const items = groupedSchedule[dateStr] || [];
            return (
              <div className={`day-card${formatDate(new Date()) === dateStr ? " today" : ""}`} key={dateStr}>
                <header>
                  <div>{displayDate(dateObj)}</div>
                </header>
                <div className="assignments">
                  {items.length === 0 && <span className="muted">No steps scheduled</span>}
                  {items.map((item, idx) => {
                    const option = options.find((o) => o.id === item.optionId);
                    const row = option?.rows.find((r) => r.id === item.stepId);
                    const itemKey = `${item.optionId}-${item.stepId}`;
                    const isDone = !!statusByDate[completionKey(dateStr, item.optionId, item.stepId)];
                    return (
                      <div className="assignment" key={`${dateStr}-${idx}`}>
                        <div className="assignment-main">
                          <strong>{row?.step || 'Step'}</strong>
                          <div className="time-and-complete">
                            <small className="muted">{item.hours}h</small>
                            <label className="complete-toggle">
                              <input
                                type="checkbox"
                                checked={isDone}
                                onChange={(e) => setDateCompletion(dateStr, item.optionId, item.stepId, e.target.checked)}
                              />
                              Completed
                            </label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="section-title">
          <h3>Task List</h3>
          <span className="muted">Track steps as to-dos with notes</span>
        </div>
        <div className="grid-two">
          <div>
            <h4>Active Steps</h4>
            <div id="taskList" className="task-list">
              {options
                .find((o) => o.id === selectedOptionId)
                ?.rows.map((row) => {
                  const key = `${selectedOptionId}-${row.id}`;
                  const dates = stepDatesByIndex[key] || [];
                  const allDatesDone =
                    dates.length > 0 &&
                    dates.every((dateStr) => statusByDate[completionKey(dateStr, selectedOptionId, row.id)]);
                  const completed = taskStatus[key]?.status === 'done' || allDatesDone;
                  if (completed) return null;
                  const notes = taskNotes[key] || '';
                  const nextDate = dates.find((dateStr) => !statusByDate[completionKey(dateStr, selectedOptionId, row.id)]);
                  return (
                    <div className="task-item" key={key}>
                      <button
                        className="small-btn ghost"
                        type="button"
                        onClick={() => markNextScheduledDate(selectedOptionId, row.id)}
                      >
                        Complete
                      </button>
                      <div>
                        <strong>{row.step || 'Step'}</strong>
                        <div className="muted task-meta">
                          <div>Requirements: {row.requirements || '-'}</div>
                          <div>Challenges: {row.challenges || '-'}</div>
                          <div>Estimated time: {row.time || 0}h</div>
                        </div>
                        <div className="task-notes">
                          <textarea placeholder="Notes" value={notes} onChange={(e) => handleTaskNotes(key, e.target.value)} />
                        </div>
                        <div className="muted scheduled-date">
                          Scheduled: {nextDate ? displayDate(new Date(`${nextDate}T00:00:00`)) : 'Unscheduled'}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
          <div>
            <h4>Completed Steps</h4>
            <div id="completedList" className="task-list">
              {options
                .find((o) => o.id === selectedOptionId)
                ?.rows.map((row) => {
                  const key = `${selectedOptionId}-${row.id}`;
                  const dates = stepDatesByIndex[key] || [];
                  const allDatesDone =
                    dates.length > 0 &&
                    dates.every((dateStr) => statusByDate[completionKey(dateStr, selectedOptionId, row.id)]);
                  const completed = taskStatus[key]?.status === 'done' || allDatesDone;
                  if (!completed) return null;
                  const completedDate =
                    taskStatus[key]?.completedDate ||
                    completedDatesByStep[key] ||
                    (dates.length ? dates[dates.length - 1] : formatDate(new Date()));
                  return (
                    <div className="task-item" key={key}>
                      <div className="muted">{row.step || 'Step'}</div>
                      <div className="muted">
                        Completed: {displayDate(new Date(`${completedDate}T00:00:00`))}
                      </div>
                      <button
                        className="small-btn ghost"
                        onClick={() => markStepActive(selectedOptionId, row.id)}
                      >
                        Mark as Active
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      </div>

      {showCompare && (
        <div className="compare-overlay" style={{ display: 'flex' }}>
          <div className="compare-dialog">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Compare and Choose</h3>
              <button className="ghost" onClick={() => setShowCompare(false)}>
                Close
              </button>
            </div>
            <div id="compareGrid" className="compare-grid" style={{ marginTop: 12 }}>
              {options.map((opt) => (
                <div className="compare-card" key={opt.id}>
                  <div className="compare-title">{opt.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{opt.rows.length} step(s)</div>
                  <div className="compare-table">
                    <div className="compare-head">
                      <span>Step</span>
                      <span>Requirements</span>
                      <span>Challenges</span>
                      <span className="time-right">Estimated Time</span>
                    </div>
                    {opt.rows.map((r, idx) => (
                      <div className="compare-row" key={`${opt.id}-${idx}`}>
                        <span>{r.step || 'Step'}</span>
                        <span className="muted">{r.requirements || '-'}</span>
                        <span className="muted">{r.challenges || '-'}</span>
                        <span className="muted time-right">{r.time || 0}h</span>
                      </div>
                    ))}
                  </div>
                  <label className="compare-select">
                    <input
                      type="radio"
                      name="compareSelect"
                      value={opt.id}
                      checked={selectedOptionId === opt.id}
                      onChange={() => setSelectedOptionId(opt.id)}
                    />
                    Select this option
                  </label>
                </div>
              ))}
            </div>
            <button id="confirmSelection" style={{ marginTop: 12 }} onClick={() => setShowCompare(false)}>
              Set as Preferred Plan
            </button>
          </div>
        </div>
      )}
    </>
  );
}

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
