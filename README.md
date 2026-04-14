# University Library MERN Platform (LibConnect Pro)

This project converts your existing single-page frontend into a MERN full-stack application with separate client and server code.

## Stack

- MongoDB
- Express.js
- React (Vite)
- Node.js

## Project Structure

- `client/` React frontend with separate JS and CSS files
- `server/` Express + MongoDB backend with role-based APIs

## Implemented Feature Modules

- Role-based authentication (`student`, `faculty`, `librarian`, `staff`, `admin`)
- Inventory manager CRUD for librarians/admin
- Smart loan periods based on demand score
- Fine blocker preventing borrowing when fines are pending
- Fine clearance and manual override endpoints
- Stock alert subscriptions and notification center
- Due-date reminder simulation endpoint at 60% and 100%
- Demand forecasting endpoint
- Usage analytics dashboard endpoint
- AR shelf navigation endpoint
- Semantic/topic search endpoint
- Research tracker module
- AI research helper endpoint (local Ollama integration)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment files:

- Copy `server/.env.example` to `server/.env`
- Copy `client/.env.example` to `client/.env`

For the AI Helper, set in `server/.env`:

```bash
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2
```

3. Start MongoDB locally (default in `.env.example`):

```bash
mongodb://127.0.0.1:27017/library_mern
```

4. Seed sample data:

```bash
npm run seed
```

5. Start both frontend and backend:

```bash
npm run dev
```

- Client: `http://localhost:5173`
- API: `http://localhost:5000/api`

## Seed Login

- Admin: `admin@uni.edu` / `password123`
- Student: `aisha@uni.edu` / `password123`

## API Overview

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET|POST|PUT|DELETE /api/books`
- `GET /api/loans`, `POST /api/loans/borrow`, `POST /api/loans/:id/renew`, `POST /api/loans/:id/return`
- `GET /api/fines`, `POST /api/fines/:id/verify-payment`, `POST /api/fines/:id/override-block`
- `GET /api/alerts`, `POST /api/alerts/:id/read`, subscriptions under `/api/alerts/subscriptions`
- `GET /api/demand/forecast`
- `GET /api/analytics/dashboard`
- `GET /api/search/semantic?q=...`
- `GET|POST|PUT /api/research`
- `POST /api/ai/assistant`
- `GET /api/navigation/ar/:bookId`

## Notes

- AI Helper now calls your local Ollama server at `OLLAMA_BASE_URL` and keeps the existing library-aware ranking/context.
- If Ollama is running but no model is available, or the request fails, `/api/ai/assistant` falls back to deterministic library-aware guidance using live catalog, loans, and project context.
- AR endpoint currently returns guidance data; mobile AR rendering can be integrated next.
