# Setup Guide: Local Voice AI Assistant

This guide will help you get your local voice AI assistant up and running.

## Prerequisites

### Hardware Requirements
- **GPU:** NVIDIA GPU with 8GB+ VRAM (e.g., RTX 3070, RTX 4070, or better)
- **RAM:** 16GB+ system memory
- **Storage:** ~20GB free space for models
- **OS:** Linux (Ubuntu 20.04+ recommended) or Windows with WSL2

### Software Requirements
- Docker (20.10+)
- Docker Compose (2.0+)
- NVIDIA Container Toolkit
- OpenWeatherMap API key (free tier works fine)

## Step 1: Install Docker and NVIDIA Container Toolkit

### Ubuntu/Debian
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker

# Verify GPU access
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi
```

### Windows (WSL2)
1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
2. Enable WSL2 integration in Docker Desktop settings
3. Install NVIDIA drivers for Windows
4. Follow the [NVIDIA Container Toolkit guide for WSL2](https://docs.nvidia.com/cuda/wsl-user-guide/index.html)

## Step 2: Get OpenWeatherMap API Key

1. Go to [OpenWeatherMap](https://openweathermap.org/api)
2. Sign up for a free account
3. Navigate to API Keys section
4. Copy your API key

## Step 3: Clone and Configure

```bash
# Clone the repository (or create the project directory)
mkdir log-002-local-voice-agent
cd log-002-local-voice-agent

# Copy the example environment file
cp .env.example .env

# Edit .env and add your OpenWeatherMap API key
nano .env
# or
vi .env
```

Update the `.env` file:
```bash
WEATHER_API_KEY=your_actual_api_key_here
```

## Step 4: Start the Services

```bash
# Pull and start all services
docker-compose up -d

# Watch the logs (optional)
docker-compose logs -f
```

### First Run Notes
- **First startup takes 10-20 minutes** as Docker downloads all images and models
- Models are cached in `~/.cache/huggingface` for faster subsequent starts
- You'll see various initialization messages - this is normal

### Verify Services

Check that all services are running:
```bash
docker-compose ps
```

You should see:
- `vllm-server` (port 8000)
- `whisper-server` (port 8001)
- `websocket-backend` (port 8002)
- `kokoro-tts` (port 8880)
- `voice-frontend` (port 3001)

### Check Service Health

```bash
# Check vLLM
curl http://localhost:8000/health

# Check Whisper
curl http://localhost:8001/health

# Check Backend
curl http://localhost:8002/health

# Check TTS
curl http://localhost:8880/docs
```

## Step 5: Access the Frontend

Open your browser and navigate to:
```
http://localhost:3001
```

You should see the voice assistant interface!

## Step 6: First Conversation

1. Click "Start Listening" button
2. Allow microphone access when prompted
3. Say something like: "What's the weather in Tokyo?"
4. Click "Stop" when you're done speaking
5. Wait for the AI to respond (this may take 3-5 seconds)
6. Listen to the voice response!

## Troubleshooting

### GPU Out of Memory

If you get GPU out of memory errors, reduce GPU memory allocation:

```yaml
# In docker-compose.yml, update vllm command:
--gpu-memory-utilization 0.4  # Reduce from 0.6 to 0.4
```

Or use smaller models:
```yaml
# For vLLM (in docker-compose.yml command section)
command: >
  Qwen/Qwen2-7B-Instruct
  --enable-auto-tool-choice
  --tool-call-parser hermes

# For Whisper (in environment)
WHISPER_MODEL=tiny.en  # Smallest, fastest
```

### Slow Response Times

**Reduce model size:**
```yaml
# Whisper
WHISPER_MODEL=tiny.en  # ~100MB vs ~500MB for distil-small

# vLLM (use in command section)
command: >
  Qwen/Qwen2-7B-Instruct  # Slightly smaller
  --enable-auto-tool-choice
  --tool-call-parser hermes
```

**Reduce max tokens:**
```yaml
--max-model-len 512  # Instead of 1024
```

### WebSocket Connection Failed

Check that the backend is running:
```bash
docker-compose logs websocket-backend
```

Verify the WebSocket URL in frontend environment:
```bash
# Should be ws://localhost:8002/ws
echo $VITE_WS_URL
```

### Audio Not Playing

1. Check browser console (F12) for errors
2. Verify browser supports audio playback
3. Check TTS service logs:
```bash
docker-compose logs kokoro-tts
```

### Microphone Not Working

1. Grant microphone permissions in browser
2. Check browser console for errors
3. Verify microphone works in other apps
4. Try a different browser (Chrome/Edge recommended)

### Weather Tool Not Working

1. Verify API key is set in `.env`:
```bash
grep WEATHER_API_KEY .env
```

2. Check if API key is valid:
```bash
curl "http://api.openweathermap.org/data/2.5/weather?q=London&appid=YOUR_API_KEY"
```

3. Check backend logs for errors:
```bash
docker-compose logs websocket-backend | grep -i weather
```

## Performance Optimization

### For Better Latency

1. **Use INT8 quantization:**
```yaml
# Already enabled for Whisper
WHISPER_COMPUTE_TYPE=int8
```

2. **Reduce LLM response length:**
```python
# In backend.py, adjust max_tokens
"max_tokens": 100  # Shorter responses = faster
```

3. **Use faster voice:**
```python
# In backend.py, TTS configuration
"speed": 1.2  # Slightly faster speech
```

### For Lower Memory Usage

1. **Share GPU efficiently:**
```yaml
# Reduce vLLM memory
--gpu-memory-utilization 0.4

# Use smaller Whisper model
WHISPER_MODEL=tiny.en
```

2. **Disable services you don't need:**
```bash
# Stop TTS if testing STT only
docker-compose stop kokoro-tts
```

## Monitoring

### Watch GPU Usage
```bash
watch -n 1 nvidia-smi
```

### Monitor Container Resources
```bash
docker stats
```

### View Real-time Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f websocket-backend
docker-compose logs -f vllm
docker-compose logs -f whisper
```

## Updating

### Update Docker Images
```bash
docker-compose pull
docker-compose up -d
```

### Update Code
```bash
git pull
docker-compose up -d --build
```

### Clear Cache (if needed)
```bash
# Stop all services
docker-compose down

# Clear models cache (will re-download)
rm -rf ~/.cache/huggingface

# Rebuild
docker-compose up -d
```

## Development Mode

### Frontend Development
```bash
# Run frontend locally for development
cd frontend
npm install
npm run dev

# Frontend will hot-reload on changes
```

### Backend Development
```bash
# Run backend locally
python backend.py

# Or with auto-reload
uvicorn backend:app --reload --host 0.0.0.0 --port 8001
```

## Production Deployment

For production use:

1. **Use HTTPS/WSS:**
```bash
# Add nginx reverse proxy
# Configure SSL certificates
# Update VITE_WS_URL to wss://
```

2. **Add authentication:**
```python
# Add API key or JWT authentication to backend
```

3. **Use production builds:**
```bash
# Frontend production build
cd frontend
npm run build
```

4. **Set resource limits:**
```yaml
# In docker-compose.yml
services:
  vllm:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 16G
```

5. **Enable monitoring:**
```bash
# Add Prometheus + Grafana
# Monitor response times, errors, GPU usage
```

## Next Steps

- Read the [main README](README.md) for architecture details
- Customize voices in `backend.py` (change TTS voice)
- Add more tools beyond weather (see README for examples)
- Fine-tune models for your use case
- Integrate with home automation systems

## Getting Help

- Check logs: `docker-compose logs -f`
- GPU issues: Run `nvidia-smi` to verify GPU is accessible
- API issues: Check service health endpoints
- Network issues: Verify all ports are accessible

## Common Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart a service
docker-compose restart websocket-backend

# View logs
docker-compose logs -f websocket-backend

# Rebuild after code changes
docker-compose up -d --build

# Check service status
docker-compose ps

# Remove everything (including volumes)
docker-compose down -v
```

Enjoy your local voice AI assistant!
