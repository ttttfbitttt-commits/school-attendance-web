FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NASQ_PORT=8767

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./
COPY web ./web

RUN mkdir -p /var/lib/soundtable

EXPOSE 8767
CMD ["python", "server.py"]
