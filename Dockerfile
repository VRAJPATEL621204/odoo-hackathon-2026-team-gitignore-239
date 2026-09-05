# Stage 1: Build the React frontend
FROM node:20-alpine AS client-builder

WORKDIR /app/client

COPY client/package*.json ./
RUN npm install

COPY client/ ./
RUN npm run build

# Stage 2: Unified Production Application (Express API + Static React Frontend)
FROM node:20-alpine

WORKDIR /app

# Prisma on Alpine requires openssl and libc compatibility libraries
RUN apk add --no-cache openssl libc6-compat

# Copy server package definitions and prisma schema
COPY server/package*.json ./server/
COPY server/prisma/ ./server/prisma/

WORKDIR /app/server
RUN npm install
RUN npx prisma generate

# Copy server code
COPY server/ ./

# Copy built frontend from Stage 1 so Express serves it
COPY --from=client-builder /app/client/dist /app/client/dist

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && if [ \"$SEED_DATABASE\" = \"true\" ]; then npm run seed; fi && npm start"]
