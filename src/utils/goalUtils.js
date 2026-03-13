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

const displayDate = (d) =>
  d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

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

export {
  makeId,
  formatDate,
  displayDate,
  createRow,
  buildDefaultGoal,
  nextWorkingDate,
  buildSchedule,
  ensureOptionRowIds,
  normalizeSchedule,
  normalizeStatusByDate,
  normalizeKeyedMap,
  buildTaskStatusForSave
};
