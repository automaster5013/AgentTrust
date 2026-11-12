FROM python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72 AS test
WORKDIR /app
COPY requirements*.txt ./
RUN pip install --no-cache-dir -r requirements-test.txt
COPY app.py features.py telemetry.py providers.py execution_profiles.py test_worker.py test_features.py test_providers.py test_execution_profiles.py test_telemetry.py ./
COPY quality_*.py test_quality_*.py quality-validator-profile.json quality-execution-profiles.json ./
COPY operations_application.py test_operations_readiness.py ./
COPY recorded_*.py test_recorded_*.py recorded-text-execution-profile.json ./
COPY connector_*.py test_connector_*.py connector-*.json ./
RUN pytest -q
FROM python:3.14-alpine@sha256:f6a589d43c42b9e7f7dc67a12d37132491f362859a5d750607710cc56da3bc72
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && adduser -D -H -u 10001 worker
RUN python -m pip uninstall -y pip setuptools
COPY --from=test /app/app.py ./
COPY --from=test /app/features.py ./
COPY --from=test /app/telemetry.py ./
COPY --from=test /app/providers.py ./
COPY --from=test /app/execution_profiles.py ./
COPY --from=test /app/quality_application.py /app/quality_worker.py /app/quality_provider.py /app/quality_evaluator.py /app/quality_profiles.py /app/quality-validator-profile.json ./
COPY --from=test /app/operations_application.py ./
COPY --from=test /app/recorded_application.py /app/recorded_worker.py /app/recorded_evaluator.py /app/recorded_profiles.py /app/recorded-text-execution-profile.json ./
COPY --from=test /app/connector_application.py /app/connector_worker.py /app/connector_evaluator.py /app/connector_profiles.py /app/connector-execution-profile.json /app/connector-validator-profile.json ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 CMD ["python","-c","import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=3)"]
CMD ["uvicorn","connector_application:app","--host","0.0.0.0","--port","8000","--no-access-log","--limit-concurrency","32","--timeout-keep-alive","5"]
