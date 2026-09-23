FROM python:3.12-slim@sha256:44ff437bba879d4941b710a369a8f19266aea34b29002807f0c487fabc9eec9b
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home processor
COPY server.py pipeline.py ./
USER processor
EXPOSE 8080
CMD ["python", "server.py"]
