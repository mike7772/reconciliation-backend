FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY . .

RUN npx prisma generate
# Type-check as a build-time gate (fails the image build on type errors)
# without emitting build/ output - the container runs the TypeScript
# source directly via ts-node at runtime instead, so there's no compiled
# build/ directory the runtime depends on ever being present/in sync.
RUN npx tsc --noEmit

EXPOSE 4000

CMD ["npx", "ts-node", "--transpile-only", "server.ts"]
