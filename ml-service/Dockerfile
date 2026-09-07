# PharmaZs ML service — FastAPI + uvicorn
#
# Python 3.14 is not incidental: requirements.txt pins cp314-verified wheels
# (numpy 2.5.3, pandas 3.0.5, scikit-learn 1.9.0). Do not downgrade the base
# image without re-pinning those.

FROM python:3.14-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Build toolchain is needed only if a wheel is missing for this platform; it is
# removed in the same layer so it never reaches the final image.
COPY requirements.txt ./
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc g++ \
 && pip install --no-cache-dir -r requirements.txt \
 && apt-get purge -y --auto-remove gcc g++ \
 && rm -rf /var/lib/apt/lists/*

COPY app ./app

RUN useradd --create-home --uid 1000 mlsvc
USER mlsvc

# 0.0.0.0 is REQUIRED here and is not a loosening of the internal-only rule:
# the API runs in a different network namespace, so a loopback bind is
# unreachable. Keep this service off any public ingress — in compose it has no
# published port, and on a PaaS it must have no public domain.
ENV ML_HOST=0.0.0.0 \
    ML_PORT=8000
EXPOSE 8000

# run.sh activates a local .venv, which does not exist in the image (deps are
# installed system-wide here), so invoke uvicorn directly.
CMD ["sh", "-c", "python -m uvicorn app.main:app --host \"$ML_HOST\" --port \"${PORT:-$ML_PORT}\""]
