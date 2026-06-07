FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
