FROM node:18-alpine AS frontend-builder
WORKDIR /app
COPY frontend/ ./frontend/
RUN npm --prefix frontend install && npm --prefix frontend run build

FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libxcb1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV MODEL_PATH=/app/models/aggregated_efficientnet_b3.pth

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
COPY models/ /app/models/
COPY --from=frontend-builder /app/frontend/build/ /app/frontend/build/

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
