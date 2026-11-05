# syntax=docker/dockerfile:1

FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    XDG_CACHE_HOME=/opt/cache HOME=/home/app
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Copilot 런타임을 이미지에 미리 내려받아 기동 시 외부 다운로드에 의존하지 않는다.
RUN python -c "from copilot._cli_download import download_cli; print(download_cli())" \
    && chmod -R a+rX /opt/cache
COPY backend/app ./app
COPY --from=web /web/dist ./static
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION} STATIC_DIR=/app/static
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
