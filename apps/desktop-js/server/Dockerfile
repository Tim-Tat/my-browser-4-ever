FROM node:24-alpine

WORKDIR /app
COPY package.json index.js ./
COPY src ./src

ENV AVEN_HOST=0.0.0.0 \
    AVEN_PORT=8787 \
    AVEN_DB=/data/aven-server.db

RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/v1/health || exit 1
CMD ["node", "index.js"]
