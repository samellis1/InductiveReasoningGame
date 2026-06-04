import express from 'express';
import cors from 'cors';
import db from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

export const STAGES = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];

// ---------- Contacts ----------
app.get('/api/contacts', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const rows = q
    ? db.prepare(`SELECT * FROM contacts
        WHERE name LIKE ? OR email LIKE ? OR company LIKE ?
        ORDER BY name`).all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare(`SELECT * FROM contacts ORDER BY name`).all();
  res.json(rows);
});

app.get('/api/contacts/:id', (req, res) => {
  const contact = db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'not found' });
  const notes = db.prepare(`SELECT * FROM notes WHERE contact_id = ? ORDER BY created_at DESC`).all(contact.id);
  const deals = db.prepare(`SELECT * FROM deals WHERE contact_id = ? ORDER BY created_at DESC`).all(contact.id);
  const tasks = db.prepare(`SELECT * FROM tasks WHERE contact_id = ? ORDER BY done, due_date`).all(contact.id);
  res.json({ ...contact, notes, deals, tasks });
});

app.post('/api/contacts', (req, res) => {
  const { name, email, phone, company } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare(`INSERT INTO contacts (name, email, phone, company) VALUES (?, ?, ?, ?)`)
    .run(name, email || null, phone || null, company || null);
  res.json(db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(info.lastInsertRowid));
});

app.put('/api/contacts/:id', (req, res) => {
  const { name, email, phone, company } = req.body;
  db.prepare(`UPDATE contacts SET name=?, email=?, phone=?, company=? WHERE id=?`)
    .run(name, email || null, phone || null, company || null, req.params.id);
  res.json(db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(req.params.id));
});

app.delete('/api/contacts/:id', (req, res) => {
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- Notes ----------
app.post('/api/contacts/:id/notes', (req, res) => {
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'body required' });
  const info = db.prepare(`INSERT INTO notes (contact_id, body) VALUES (?, ?)`).run(req.params.id, body);
  res.json(db.prepare(`SELECT * FROM notes WHERE id = ?`).get(info.lastInsertRowid));
});

app.delete('/api/notes/:id', (req, res) => {
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- Deals ----------
app.get('/api/deals', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, c.name AS contact_name
    FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id
    ORDER BY d.created_at DESC`).all();
  res.json({ stages: STAGES, deals: rows });
});

app.post('/api/deals', (req, res) => {
  const { contact_id, title, value, stage } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const s = STAGES.includes(stage) ? stage : 'Lead';
  const info = db.prepare(`INSERT INTO deals (contact_id, title, value, stage) VALUES (?, ?, ?, ?)`)
    .run(contact_id || null, title, Number(value) || 0, s);
  res.json(db.prepare(`SELECT * FROM deals WHERE id = ?`).get(info.lastInsertRowid));
});

app.put('/api/deals/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { contact_id, title, value, stage } = req.body;
  const s = STAGES.includes(stage) ? stage : existing.stage;
  db.prepare(`UPDATE deals SET contact_id=?, title=?, value=?, stage=? WHERE id=?`)
    .run(contact_id ?? existing.contact_id, title ?? existing.title,
         value !== undefined ? Number(value) : existing.value, s, req.params.id);
  res.json(db.prepare(`SELECT * FROM deals WHERE id = ?`).get(req.params.id));
});

app.delete('/api/deals/:id', (req, res) => {
  db.prepare(`DELETE FROM deals WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ---------- Tasks ----------
app.get('/api/tasks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, c.name AS contact_name
    FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
    ORDER BY t.done, t.due_date IS NULL, t.due_date`).all();
  res.json(rows);
});

app.post('/api/tasks', (req, res) => {
  const { contact_id, title, due_date } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare(`INSERT INTO tasks (contact_id, title, due_date) VALUES (?, ?, ?)`)
    .run(contact_id || null, title, due_date || null);
  res.json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid));
});

app.put('/api/tasks/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { title, due_date, done, contact_id } = req.body;
  db.prepare(`UPDATE tasks SET title=?, due_date=?, done=?, contact_id=? WHERE id=?`).run(
    title ?? existing.title,
    due_date ?? existing.due_date,
    done !== undefined ? (done ? 1 : 0) : existing.done,
    contact_id ?? existing.contact_id,
    req.params.id
  );
  res.json(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(req.params.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`CRM API listening on http://localhost:${port}`));
