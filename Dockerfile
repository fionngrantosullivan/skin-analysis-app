FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY frontend/ ./frontend/
RUN npm --prefix frontend install && npm --prefix frontend run build

FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libxcb1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV MODEL_PATH=/app/models/aggregated_efficientnet_b3.pth

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY --from=frontend-builder /app/frontend/build/ /app/frontend/build/

RUN mkdir -p /app/models && \
    curl -L "https://huggingface.co/fosullyy/skin-analysis-efficient-net-b3/resolve/main/aggregated_efficientnet_b3.pth" \
    -o /app/models/aggregated_efficientnet_b3.pth

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
