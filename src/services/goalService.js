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

const goalsCollection = (db, user) => collection(db, 'users', user.uid, 'goals');
const goalDoc = (db, user, goalId) => doc(db, 'users', user.uid, 'goals', goalId);

const subscribeGoals = (db, user, onChange) => {
  const q = query(goalsCollection(db, user), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    onChange(items);
  });
};

const createGoal = async (db, user, payload) =>
  addDoc(goalsCollection(db, user), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

const updateGoalMeta = async (db, user, goalId, updates) =>
  updateDoc(goalDoc(db, user, goalId), {
    ...updates,
    updatedAt: serverTimestamp()
  });

const deleteGoal = async (db, user, goalId) => deleteDoc(goalDoc(db, user, goalId));

const fetchGoal = async (db, user, goalId) => getDoc(goalDoc(db, user, goalId));

const upsertGoal = async (db, user, goalId, payload, includeCreatedAt = false) =>
  setDoc(
    goalDoc(db, user, goalId),
    {
      ...payload,
      ...(includeCreatedAt ? { createdAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

export { subscribeGoals, createGoal, updateGoalMeta, deleteGoal, fetchGoal, upsertGoal };
