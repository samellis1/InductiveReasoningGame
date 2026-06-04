import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Pipeline() {
  const [stages, setStages] = useState([]);
  const [deals, setDeals] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const load = async () => {
    const data = await api.listDeals();
    setStages(data.stages);
    setDeals(data.deals);
  };

  useEffect(() => { load(); api.listContacts().then(setContacts); }, []);

  const move = async (id, stage) => {
    const deal = deals.find((d) => d.id === id);
    if (!deal || deal.stage === stage) return;
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, stage } : d)));
    try { await api.updateDeal(id, { stage }); } finally { load(); }
  };

  const onDragStart = (e, id) => {
    e.dataTransfer.setData('text/plain', String(id));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e, stage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== stage) setDragOver(stage);
  };
  const onDrop = (e, stage) => {
    e.preventDefault();
    const id = Number(e.dataTransfer.getData('text/plain'));
    setDragOver(null);
    if (id) move(id, stage);
  };

  return (
    <>
      <div className="row">
        <h2>Pipeline</h2>
        <button className="primary" onClick={() => setCreating(true)}>+ New Deal</button>
      </div>

      {creating && (
        <DealForm
          contacts={contacts}
          stages={stages}
          onCancel={() => setCreating(false)}
          onSave={async (data) => { await api.createDeal(data); setCreating(false); load(); }}
        />
      )}

      <div className="pipeline">
        {stages.map((s) => {
          const col = deals.filter((d) => d.stage === s);
          const total = col.reduce((a, d) => a + Number(d.value || 0), 0);
          return (
            <div
              key={s}
              className={`col ${dragOver === s ? 'drag-over' : ''}`}
              onDragOver={(e) => onDragOver(e, s)}
              onDragLeave={() => setDragOver((cur) => (cur === s ? null : cur))}
              onDrop={(e) => onDrop(e, s)}
            >
              <h3>{s} <span className="muted">· ${total.toLocaleString()}</span></h3>
              {col.map((d) => editingId === d.id ? (
                <DealForm
                  key={d.id}
                  contacts={contacts}
                  stages={stages}
                  initial={d}
                  onCancel={() => setEditingId(null)}
                  onSave={async (data) => { await api.updateDeal(d.id, data); setEditingId(null); load(); }}
                />
              ) : (
                <div
                  key={d.id}
                  className="deal"
                  draggable
                  onDragStart={(e) => onDragStart(e, d.id)}
                >
                  <div className="title">{d.title}</div>
                  <div className="muted">{d.contact_name || '—'} · ${Number(d.value).toLocaleString()}</div>
                  <div className="row" style={{ marginTop: 6, marginBottom: 0 }}>
                    <select value={d.stage} onChange={(e) => move(d.id, e.target.value)}>
                      {stages.map((s2) => <option key={s2} value={s2}>{s2}</option>)}
                    </select>
                    <div style={{ flex: 1 }} />
                    <button className="ghost" onClick={() => setEditingId(d.id)}>Edit</button>
                    <button className="danger" onClick={async () => { await api.deleteDeal(d.id); load(); }}>×</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

function DealForm({ contacts, stages, initial, onCancel, onSave }) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    value: initial?.value ?? 0,
    stage: initial?.stage ?? 'Lead',
    contact_id: initial?.contact_id ? String(initial.contact_id) : '',
  });
  return (
    <div className="card">
      <div className="form-grid">
        <input placeholder="Deal title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input placeholder="Value" type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
          {stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={form.contact_id} onChange={(e) => setForm({ ...form, contact_id: e.target.value })}>
          <option value="">— No contact —</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="row" style={{ marginTop: 12, marginBottom: 0 }}>
        <div style={{ flex: 1 }} />
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <button className="primary" disabled={!form.title.trim()} onClick={() => onSave({
          ...form,
          contact_id: form.contact_id ? Number(form.contact_id) : null,
          value: Number(form.value) || 0,
        })}>Save</button>
      </div>
    </div>
  );
}
