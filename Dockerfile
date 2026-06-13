# Use official lightweight Python image
FROM python:3.9-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

# Set work directory
WORKDIR /app

# Install dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY app.py /app/
COPY static /app/static/

# Expose default port
EXPOSE 8000

# Command to run the application using uvicorn with dynamic port mapping
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
