FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
# The server itself has no runtime dependencies: it only needs its own code and the built UI.
COPY --from=build /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
ENV HOST=0.0.0.0 PORT=4477 PRETTY_DATA_DIR=/data PRETTY_CONTENT_DIR=/content
RUN mkdir -p /data /content && chown node:node /data /content
VOLUME ["/data", "/content"]
EXPOSE 4477
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
