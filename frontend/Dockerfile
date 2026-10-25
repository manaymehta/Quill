# The Vite dev server for docker-compose (production builds are Vercel's). Builds from the local
# working tree as well as from a fresh clone: locally, package.json holds pnpm "catalog:" versions
# that npm can't read, so the dependency versions are taken from package-lock.json.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));const r=JSON.parse(fs.readFileSync('package-lock.json')).packages[''];for(const s of ['dependencies','devDependencies','optionalDependencies'])if(p[s])p[s]=r[s]||p[s];fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && npm ci --legacy-peer-deps
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
