FROM node:22-alpine AS base

WORKDIR /app

COPY package*.json .

RUN npm install

# Development Stage
FROM base AS development

COPY . .

EXPOSE 8000

CMD ["npm", "run", "dev"]

# Production Stage
FROM base AS production

COPY . .

EXPOSE 8000

CMD ["npm", "run", "start"]
