FROM node:22.18.0-bookworm-slim AS frontend-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && cp node_modules/xlsx/dist/xlsx.full.min.js dist/assets/xlsx.full.min.js

FROM gcc:14.3.0-bookworm AS backend-build

WORKDIR /app

COPY backend ./backend
RUN mkdir -p build \
    && g++ -std=c++20 -O2 -pthread -Wall -Wextra -static-libstdc++ -static-libgcc \
        backend/main.cpp -o build/dataeum-server

FROM debian:bookworm-slim AS runtime

RUN groupadd --system --gid 10001 dataeum \
    && useradd --system --uid 10001 --gid dataeum --home-dir /app --shell /usr/sbin/nologin dataeum

WORKDIR /app

COPY --from=backend-build --chown=dataeum:dataeum /app/build/dataeum-server ./build/dataeum-server
COPY --from=frontend-build --chown=dataeum:dataeum /app/dist ./dist
COPY --chown=dataeum:dataeum index.html styles.css ./

USER dataeum

EXPOSE 8001

CMD ["./build/dataeum-server"]
