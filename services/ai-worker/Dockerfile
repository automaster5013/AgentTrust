FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS test
WORKDIR /app
COPY requirements*.txt ./
RUN pip install --no-cache-dir -r requirements-test.txt
COPY app.py test_worker.py ./
RUN pytest -q
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --no-create-home worker
COPY --from=test /app/app.py ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 CMD ["python","-c","import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3)"]
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8000","--no-access-log","--limit-concurrency","32","--timeout-keep-alive","5"]
