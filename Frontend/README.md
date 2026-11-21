# Clay — procurement assistant (UI prototype)

React 18 + Vite. No backend: all data is in `src/data.js` (REQ-1001 from the brief; the rest is invented sample data).

    npm install
    npm run dev       # http://localhost:5173
    npm run build

## Structure
- `src/data.js`        demo data, derived helpers, email drafts, log
- `src/store.jsx`      one reducer: login, send RFQ, simulate replies, HOD decisions
- `src/App.jsx`        hash router + role guard
- `src/components/`    Layout, shared UI, request cards, ranking table, drawer
- `src/pages/`         Login, PM (inbox/outbox/requests/report), HOD, Admin

## Connecting a real backend
Replace the reducer actions in `store.jsx` with API calls (send RFQ, approve, send back)
and load `reqs` from your API instead of `initialReqs()`.
Strings like `[email]` render as grey placeholders via `<Txt>`.
