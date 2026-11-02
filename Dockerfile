# syntax=docker/dockerfile:1

# Build the client (Vite bundles React, force-graph and d3, so none of them ship in the final image).
FROM docker.io/library/node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# Runtime: the Express server plus the built client.
FROM docker.io/library/node:26-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/api/session || exit 1
CMD ["node", "server/index.js"]
