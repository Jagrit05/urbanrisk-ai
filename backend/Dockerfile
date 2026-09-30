FROM python:3.12-slim

WORKDIR /app

# xgboost/shap need a C++ runtime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Bake the trained artifacts into the image so the container is self-contained
# (cloud deploys like Render have no volume mounts; docker-compose still
# bind-mounts the host folder over this path at runtime).
COPY model_artifacts ./model_artifacts

# Mount your M1-M4 artifacts here at runtime (see docker-compose.yml)
ENV MODELS_DIR=/app/model_artifacts

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
