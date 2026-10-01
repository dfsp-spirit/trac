FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN pip install --no-cache-dir uv

WORKDIR /workspace/backend

CMD ["sh", "-lc", "uv sync --dev && uv run gunicorn --reload -c /workspace/dev_tools/docker/gunicorn_conf.docker.py o_timeusediary_backend.api:app"]
