# Stage 1: build the frontend
FROM node:22-alpine AS ui
WORKDIR /ui
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: runtime — Python + ffmpeg + yt-dlp + FastAPI serving API and UI
FROM python:3.12-slim
# deno: yt-dlp 2026.x needs a JS runtime for full YouTube extraction —
# without one some videos fail outright and format lists are incomplete.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg handbrake-cli curl unzip \
    && case "$(dpkg --print-architecture)" in \
         amd64) DENO_ARCH=x86_64-unknown-linux-gnu ;; \
         arm64) DENO_ARCH=aarch64-unknown-linux-gnu ;; \
       esac \
    && curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_ARCH}.zip" \
    && unzip -q /tmp/deno.zip -d /usr/local/bin \
    && rm /tmp/deno.zip \
    && apt-get purge -y curl unzip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./backend/app
COPY --from=ui /ui/dist ./static
ENV HOARDLINE_DATA=/data
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
