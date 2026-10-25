# Builds from the local working tree as well as from a fresh clone. Locally, package.json holds pnpm
# "catalog:" versions that npm can't read, so the dependency versions are taken from
# package-lock.json (the file CI installs from), which is the same in both.
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));const r=JSON.parse(fs.readFileSync('package-lock.json')).packages[''];for(const s of ['dependencies','devDependencies','optionalDependencies'])if(p[s])p[s]=r[s]||p[s];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && mkdir -p /resolved && cp package.json /resolved/package.json

# Development (docker-compose): every dependency, the source bind-mounted over /app, nodemon
FROM base AS development
RUN npm ci --legacy-peer-deps
COPY . .
RUN cp /resolved/package.json package.json
EXPOSE 8000
CMD ["npm", "run", "dev"]

# Production: runtime dependencies only, as the unprivileged node user
FROM base AS production
ENV NODE_ENV=production
RUN npm ci --legacy-peer-deps --omit=dev
COPY --chown=node:node . .
RUN cp /resolved/package.json package.json
USER node
EXPOSE 8000
CMD ["npm", "run", "start"]
