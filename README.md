# FleetOpz — Full-Stack Car Rental Management

A car-rental fleet business dashboard: cars, bookings, earnings, expenses, P&L
reports, invoices/agreements (PDF), and alerts. React frontend, Express + JWT
backend, PostgreSQL database.

## Stack
- **Frontend:** React 18 (Vite), jspdf. Auth via JWT stored in localStorage.
- **Backend:** Express 5, pg, JWT (jsonwebtoken), bcryptjs.
- **Database:** PostgreSQL.

## Prerequisites
- Node.js 18+
- PostgreSQL installed and running locally

## Setup

### 1. Database
```bash
createdb fleetopz
psql -U postgres -d fleetopz -f backend/src/config/schema.sql
```
The schema creates the `users`, `cars`, `bookings`, `earnings`, `expenses`
tables and seeds 8 demo cars.

### 2. Backend
```bash
cd backend
cp .env.example .env      # then edit DB credentials + JWT_SECRET
npm install
npm run dev               # http://localhost:5000
```
(`npm run db:init` re-runs the schema against the `fleetopz` database.)

### 3. Frontend
```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

### 4. First run
Open the app, click **Create one** on the login screen to register the first
admin account, and sign in. The seeded demo cars appear under **Fleet**.

## API
All routes are under `/api`. Everything except register/login requires an
`Authorization: Bearer <token>` header.

| Method | Route | Auth | Notes |
|--------|-------|------|-------|
| POST | `/auth/register` | — | name, email, password → returns `{ token, user }` |
| POST | `/auth/login` | — | email, password → returns `{ token, user }` |
| GET  | `/auth/me` | token | current user |
| GET/POST | `/fleet` | token | list / create cars (id = `plate`) |
| PUT/DELETE | `/fleet/:plate` | token | update / delete a car |
| GET/POST | `/bookings` | token | list / create bookings (id = `BK-xxx`) |
| PUT/DELETE | `/bookings/:id` | token | update / delete |
| GET/POST | `/earnings` | token | list / create earnings (id = `ER-xxx`) |
| PUT/DELETE | `/earnings/:id` | token | update / delete |
| GET/POST | `/expenses` | token | list / create expenses (id = `EX-xxx`) |
| PUT/DELETE | `/expenses/:id` | token | update / delete |

## How the layers connect (request flow)

UI action → data hook → HTTP → route → middleware → controller → model → DB,
and the response returns along the same path.

```
frontend/src/*.jsx            (Fleet, Booking, Earning, Expenses screens)
        │  call add/update/delete from…
frontend/src/useFleetData.js  (the single data hook — the whole app's data lives here)
        │  via frontend/src/services/api.js (attaches JWT, calls fetch)
        ▼  HTTP  (e.g. POST /api/fleet)
backend/src/routes/*Routes.js       maps URL+method → controller
backend/src/middleware/auth.js      verifies the JWT (protected routes)
backend/src/controllers/*.js        validates input, calls the model
backend/src/models/*.js             the ONLY layer that runs SQL
backend/src/config/db.js            PostgreSQL connection pool
        ▼
PostgreSQL (cars / bookings / earnings / expenses / users)
```

Auth is handled by `frontend/src/context/AuthContext.jsx` + `Login.jsx`, gated
in `frontend/src/main.jsx` (shows Login until a valid session exists).

## Notes
- The frontend keeps all business logic (booking-status derivation, KPIs,
  monthly targets, alerts) client-side in `useFleetData.js`; the backend is a
  straightforward CRUD + auth API. Record IDs are generated on the frontend and
  stored as-is by the backend.
- Writes are optimistic: the UI updates immediately, then persists to the API;
  a failed write triggers a resync from the server.
