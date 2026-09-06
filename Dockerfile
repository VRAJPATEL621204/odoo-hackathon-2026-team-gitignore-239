# Stage 1: Build the React frontends (PeoplePay360 main UI + Standalone AI Chatbot UI)
FROM node:20-alpine AS client-builder

# 1. Build main PeoplePay360 client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# 2. Build standalone AI Chatbot client
WORKDIR /app/ai-chatbot/client
COPY ai-chatbot/client/package*.json ./
RUN npm install
COPY ai-chatbot/client/ ./
RUN npm run build

# Stage 2: Unified Production Application (Express API + Static React Frontends + AI Chatbot Service)
FROM node:20-alpine

WORKDIR /app

# Prisma on Alpine requires openssl and libc compatibility libraries; curl for container health checks
RUN apk add --no-cache openssl libc6-compat curl

# 1. Setup PeoplePay360 Server dependencies & Prisma client
WORKDIR /app/server
COPY server/package*.json ./
COPY server/prisma/ ./prisma/
RUN npm install
RUN npx prisma generate
COPY server/ ./

# 2. Setup AI Chatbot Service dependencies & files
WORKDIR /app/ai-chatbot
COPY ai-chatbot/package*.json ./
RUN npm install --omit=dev
COPY ai-chatbot/ ./
# Copy pre-built standalone AI Chatbot web interface into ai-chatbot/client/dist
COPY --from=client-builder /app/ai-chatbot/client/dist ./client/dist

# 3. Copy built PeoplePay360 frontend from Stage 1 so Express serves it
COPY --from=client-builder /app/client/dist /app/client/dist

WORKDIR /app/server

# Expose PeoplePay360 (5000) and AI Chatbot (4500)
EXPOSE 5000 4500

ENV PORT=5000 \
    CHATBOT_PORT=4500 \
    PEOPLEPAY360_API_BASE_URL=http://localhost:5000


# Migrations failing genuinely means the schema is broken — that should stop
# the container. Seeding failing should not: it's demo data, and a working app
# with no demo data beats a container that refuses to boot over it. seed.js
# is itself resilient section-by-section (see prisma/seed.js), but the `||`
# here is the last line of defence regardless of what goes wrong inside it.
#
# The banner echo right before `npm start` is deliberate: it's the one line
# guaranteed to show up in `docker logs`/`docker compose up` regardless of how
# either Node process logs its own readiness, naming the exact ports mapped in
# docker-compose.yml so nobody has to go read this file to find them.
CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_DATABASE\" = \"true\" ]; then npm run seed || echo '[seed] failed — starting without demo data'; fi && (cd /app/ai-chatbot && PORT=4500 node server/index.js &) && echo \"[app] PeoplePay360 API on port ${PORT:-5000} | AI chatbot on port ${CHATBOT_PORT:-4500}\" && npm start"]
