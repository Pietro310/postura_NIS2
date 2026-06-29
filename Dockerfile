# Usa un'immagine base ufficiale Python leggera e ottimizzata per la produzione
FROM python:3.11-slim

# Imposta variabili d'ambiente per impedire byte-code su disco e ottimizzare i log
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Configura la cartella di lavoro all'interno del container
WORKDIR /app

# Copia i requisiti e installali
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copia l'intero progetto (il .dockerignore escluderà cache, venv e .env)
COPY . /app/

# Esponi la porta 5006 di produzione
EXPOSE 5006

# Esegue Gunicorn WSGI Server con 4 worker su porta 5006
CMD ["gunicorn", "--bind", "0.0.0.0:5006", "--workers", "4", "--threads", "2", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
