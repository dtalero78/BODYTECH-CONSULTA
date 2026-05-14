# Multi-stage build: Backend + Frontend
# Este Dockerfile construye ambos componentes en un solo contenedor
# para reducir costos en Digital Ocean App Platform

# Stage 1: Build Backend
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/ .
RUN npm run build

# Stage 2: Build Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# Stage 3: Production image
FROM node:20-alpine

RUN apk add --no-cache ffmpeg chromium chromium-chromedriver nss freetype harfbuzz ca-certificates ttf-freefont

WORKDIR /app

# Copiar package.json del backend y instalar solo dependencias de produccion
COPY backend/package*.json ./
RUN npm ci --only=production

# Copiar backend compilado
COPY --from=backend-builder /app/backend/dist ./dist

# Copiar frontend compilado al directorio que el backend espera
COPY --from=frontend-builder /app/frontend/dist ./frontend-dist

EXPOSE 3000

# Puppeteer-core apunta al Chromium del sistema (Alpine).
# El paquete `puppeteer` bundled descarga un Chromium incompatible con musl libc.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

# El backend sirve tanto la API como el frontend estatico
CMD ["node", "dist/index.js"]
