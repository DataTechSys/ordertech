FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 8080

# Run Node directly to avoid npm exiting unexpectedly in some environments
CMD ["node", "server.js"]
