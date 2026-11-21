# Debian slim, not Alpine: wisp-js's bufferutil ships a prebuilt glibc binary, so nothing needs compiling
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
