# Lite CRM

A minimal CRM with contacts, notes, deal pipeline, and tasks. Express + SQLite backend, React (Vite) frontend.

## Setup

```bash
npm run install:all
```

## Run (dev)

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3001

The frontend proxies `/api/*` to the backend in dev. Data persists in `server/crm.db`.

## Production build

```bash
npm run build       # build frontend
npm start           # run API only (serve client/dist separately if desired)
```

## Structure

```
server/   Express API + better-sqlite3 (contacts, notes, deals, tasks)
client/   React + Vite UI (Contacts, Pipeline, Tasks)
```
