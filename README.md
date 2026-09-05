# Hackathon Minimal Monorepo Scaffold

A minimal starter monorepo: React + Vite frontend, Express + Prisma (TypeScript) backend, and Dockerized PostgreSQL.

---

## Quickstart

Run these exact commands in order:

### 1. Start the PostgreSQL container
```bash
docker compose up -d
```

### 2. Setup the backend & database
```bash
cd server && npm install && npx prisma generate && npx prisma db push
```

### 3. Start the backend server (separate terminal)
```bash
cd server
npm run dev
```

### 4. Setup & start the frontend client (separate terminal)
```bash
cd client && npm install && npm run dev
```

### 5. Open the Application
Open the Vite URL in your browser (default: [http://localhost:5173](http://localhost:5173)).
It will render:
- **Welcome**
- **Backend says: connected**

---

## Troubleshooting

### 1. Port 5432 already in use locally
If you already have a local PostgreSQL instance running on port 5432:
- Change `POSTGRES_PORT=5433` in `.env` and `docker-compose.yml`
- Update the port in `DATABASE_URL` in both root `.env` and `server/.env`:
  ```env
  DATABASE_URL="postgresql://postgres:postgres@localhost:5433/peoplepay360?schema=public"
  ```

### 2. "Can't reach database server" right after `docker compose up -d`
PostgreSQL takes a few seconds to initialize and accept connections on first launch.
- Wait for the healthcheck to become healthy before running Prisma commands:
  ```bash
  docker compose ps
  ```
- Once the status shows `(healthy)`, retry `npx prisma db push`.

### 3. "Cannot find module '@prisma/client'" or "Cannot find module '.prisma/client'"
Forgetting `npx prisma generate` after pulling schema changes from git is the #1 cause of missing Prisma client definitions.
- The `postinstall` script in `server/package.json` automatically runs `prisma generate` upon `npm install`.
- If you edit `server/prisma/schema.prisma` locally or pull updates, run:
  ```bash
  cd server && npx prisma generate
  ```
