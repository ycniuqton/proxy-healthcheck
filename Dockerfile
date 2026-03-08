FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3010

# Default: run API server. Override with "node worker.js" for worker.
CMD ["node", "server.js"]
