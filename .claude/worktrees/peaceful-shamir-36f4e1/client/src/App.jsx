import React, { useState } from 'react';
import Contacts from './views/Contacts.jsx';
import Pipeline from './views/Pipeline.jsx';
import Tasks from './views/Tasks.jsx';

export default function App() {
  const [view, setView] = useState('contacts');
  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Lite CRM</h1>
        {['contacts', 'pipeline', 'tasks'].map((v) => (
          <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </aside>
      <main className="main">
        {view === 'contacts' && <Contacts />}
        {view === 'pipeline' && <Pipeline />}
        {view === 'tasks' && <Tasks />}
      </main>
    </div>
  );
}
