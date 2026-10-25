# Python as on Render (render.yaml PYTHON_VERSION) and the tested venv
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Unprivileged user for the running service
RUN useradd --create-home --uid 10001 app
USER app

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
