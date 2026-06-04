async function req(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'request failed');
  return res.json();
}

export const api = {
  listContacts: (q) => req(`/api/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getContact: (id) => req(`/api/contacts/${id}`),
  createContact: (data) => req(`/api/contacts`, { method: 'POST', body: data }),
  updateContact: (id, data) => req(`/api/contacts/${id}`, { method: 'PUT', body: data }),
  deleteContact: (id) => req(`/api/contacts/${id}`, { method: 'DELETE' }),
  addNote: (id, body) => req(`/api/contacts/${id}/notes`, { method: 'POST', body: { body } }),
  deleteNote: (id) => req(`/api/notes/${id}`, { method: 'DELETE' }),
  listDeals: () => req(`/api/deals`),
  createDeal: (data) => req(`/api/deals`, { method: 'POST', body: data }),
  updateDeal: (id, data) => req(`/api/deals/${id}`, { method: 'PUT', body: data }),
  deleteDeal: (id) => req(`/api/deals/${id}`, { method: 'DELETE' }),
  listTasks: () => req(`/api/tasks`),
  createTask: (data) => req(`/api/tasks`, { method: 'POST', body: data }),
  updateTask: (id, data) => req(`/api/tasks/${id}`, { method: 'PUT', body: data }),
  deleteTask: (id) => req(`/api/tasks/${id}`, { method: 'DELETE' }),
};
