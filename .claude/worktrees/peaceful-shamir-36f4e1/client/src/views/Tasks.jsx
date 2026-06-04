import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState({ title: '', due_date: '', contact_id: '' });

  const load = () => api.listTasks().then(setTasks);
  useEffect(() => { load(); api.listContacts().then(setContacts); }, []);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="row"><h2>Tasks</h2></div>

      <div className="card">
        <div className="form-grid">
          <input placeholder="Task title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input type="date" value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          <select value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
            <option value="">— No contact —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="primary" disabled={!form.title.trim()} onClick={async () => {
            await api.createTask({ ...form, contact_id: form.contact_id || null });
            setForm({ title: '', due_date: '', contact_id: '' });
            load();
          }}>Add Task</button>
        </div>
      </div>

      <div className="list">
        {tasks.length === 0 && <div className="list-item muted">No tasks.</div>}
        {tasks.map((t) => {
          const overdue = !t.done && t.due_date && t.due_date < today;
          return (
            <div key={t.id} className={`task ${t.done ? 'done' : ''}`}>
              <input type="checkbox" checked={!!t.done} onChange={async (e) => {
                await api.updateTask(t.id, { done: e.target.checked }); load();
              }} />
              <span className="title" style={{ flex: 1 }}>
                {t.title}
                {t.contact_name && <span className="muted"> · {t.contact_name}</span>}
              </span>
              <span className="muted" style={{ color: overdue ? '#b91c1c' : undefined }}>
                {t.due_date || ''}
              </span>
              <button className="danger" onClick={async () => { await api.deleteTask(t.id); load(); }}>×</button>
            </div>
          );
        })}
      </div>
    </>
  );
}
