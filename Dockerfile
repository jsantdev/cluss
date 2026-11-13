FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js ./
COPY modules ./modules
COPY v21.html ./

ENV NODE_ENV=production
EXPOSE 80

CMD ["npm", "start"]
