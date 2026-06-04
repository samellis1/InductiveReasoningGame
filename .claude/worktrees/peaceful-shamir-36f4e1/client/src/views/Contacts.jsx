import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = async (query = q) => {
    const list = await api.listContacts(query);
    setContacts(list);
    if (selectedId && !list.find((c) => c.id === selectedId)) setSelectedId(null);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (selectedId) api.getContact(selectedId).then(setDetail);
    else setDetail(null);
  }, [selectedId]);

  const refreshDetail = () => selectedId && api.getContact(selectedId).then(setDetail);

  return (
    <>
      <div className="row">
        <h2>Contacts</h2>
        <input placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); load(e.target.value); }} />
        <button className="primary" onClick={() => setCreating(true)}>+ New Contact</button>
      </div>

      {creating && (
        <ContactForm
          onCancel={() => setCreating(false)}
          onSave={async (data) => {
            const c = await api.createContact(data);
            setCreating(false);
            await load();
            setSelectedId(c.id);
          }}
        />
      )}

      <div className="detail">
        <div className="list">
          {contacts.length === 0 && <div className="list-item muted">No contacts yet.</div>}
          {contacts.map((c) => (
            <div key={c.id}
              className={`list-item ${selectedId === c.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(c.id)}>
              <div>
                <div><strong>{c.name}</strong></div>
                <div className="muted">{c.company || '—'}</div>
              </div>
              <div className="muted">{c.email}</div>
            </div>
          ))}
        </div>

        <div>
          {!detail && <div className="card muted">Select a contact to view details.</div>}
          {detail && (
            <ContactDetail
              key={detail.id}
              contact={detail}
              onUpdated={async () => { await load(); await refreshDetail(); }}
              onDeleted={async () => { setSelectedId(null); await load(); }}
            />
          )}
        </div>
      </div>
    </>
  );
}

function ContactForm({ initial = {}, onCancel, onSave }) {
  const [form, setForm] = useState({
    name: initial.name || '', email: initial.email || '',
    phone: initial.phone || '', company: initial.company || ''
  });
  return (
    <div className="card">
      <div className="form-grid">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
        <div style={{ flex: 1 }} />
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!form.name.trim()} onClick={() => onSave(form)}>Save</button>
      </div>
    </div>
  );
}

function ContactDetail({ contact, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [task, setTask] = useState({ title: '', due_date: '' });

  if (editing) {
    return (
      <ContactForm
        initial={contact}
        onCancel={() => setEditing(false)}
        onSave={async (data) => { await api.updateContact(contact.id, data); setEditing(false); onUpdated(); }}
      />
    );
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 20 }}>{contact.name}</h2>
          <button className="ghost" onClick={() => setEditing(true)}>Edit</button>
          <button className="danger" onClick={async () => {
            if (confirm(`Delete ${contact.name}?`)) { await api.deleteContact(contact.id); onDeleted(); }
          }}>Delete</button>
        </div>
        <div className="muted">{contact.company || '—'}</div>
        <div>{contact.email} {contact.phone && `· ${contact.phone}`}</div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Notes</h3>
        <div className="row">
          <input style={{ flex: 1 }} placeholder="Add a note…" value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && noteBody.trim()) {
                await api.addNote(contact.id, noteBody); setNoteBody(''); onUpdated();
              }
            }} />
          <button className="primary" disabled={!noteBody.trim()} onClick={async () => {
            await api.addNote(contact.id, noteBody); setNoteBody(''); onUpdated();
          }}>Add</button>
        </div>
        {contact.notes.length === 0 && <div className="muted">No notes yet.</div>}
        {contact.notes.map((n) => (
          <div key={n.id} style={{ padding: '8px 0', borderTop: '1px solid #f3f4f6' }}>
            <div>{n.body}</div>
            <div className="row" style={{ marginBottom: 0 }}>
              <span className="muted" style={{ flex: 1 }}>{n.created_at}</span>
              <button className="danger" onClick={async () => { await api.deleteNote(n.id); onUpdated(); }}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Deals</h3>
        {contact.deals.length === 0 && <div className="muted">No deals.</div>}
        {contact.deals.map((d) => (
          <div key={d.id} className="row" style={{ marginBottom: 6 }}>
            <span style={{ flex: 1 }}>{d.title}</span>
            <span className="tag">{d.stage}</span>
            <span className="muted">${Number(d.value).toLocaleString()}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Tasks</h3>
        <div className="row">
          <input style={{ flex: 1 }} placeholder="Task title" value={task.title}
            onChange={(e) => setTask({ ...task, title: e.target.value })} />
          <input type="date" value={task.due_date}
            onChange={(e) => setTask({ ...task, due_date: e.target.value })} />
          <button className="primary" disabled={!task.title.trim()} onClick={async () => {
            await api.createTask({ contact_id: contact.id, ...task });
            setTask({ title: '', due_date: '' });
            onUpdated();
          }}>Add</button>
        </div>
        {contact.tasks.length === 0 && <div className="muted">No tasks.</div>}
        {contact.tasks.map((t) => (
          <div key={t.id} className={`task ${t.done ? 'done' : ''}`} style={{ paddingLeft: 0, paddingRight: 0 }}>
            <input type="checkbox" checked={!!t.done} onChange={async (e) => {
              await api.updateTask(t.id, { done: e.target.checked }); onUpdated();
            }} />
            <span className="title" style={{ flex: 1 }}>{t.title}</span>
            <span className="muted">{t.due_date || ''}</span>
            <button className="danger" onClick={async () => { await api.deleteTask(t.id); onUpdated(); }}>×</button>
          </div>
        ))}
      </div>
    </>
  );
}
