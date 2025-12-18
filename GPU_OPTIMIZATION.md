# GPU Memory Optimization Guide

## Your GPU Setup
- **GPU:** NVIDIA GeForce RTX 5070 Ti
- **VRAM:** 16GB
- **Available:** ~15GB free

## Memory Allocation Strategy

### Original Problem
All services were competing for GPU memory:
```
vLLM:     60% of 16GB = 9.6GB (reserved) + 5-6GB (model) = ~15GB
Whisper:  ~1-2GB
Kokoro:   Incorrectly using GPU (should be CPU-only)
Total:    Would exceed 16GB → OUT OF MEMORY
```

### Optimized Configuration

#### 1. vLLM (Primary GPU User)
```yaml
--gpu-memory-utilization 0.35  # ~5.6GB reserved for KV cache
Model size: ~5-6GB (Qwen3-8B-FP8)
Total: ~11GB
```

**Why 0.35?**
- Leaves room for Whisper (~2GB)
- Leaves system overhead (~1-2GB)
- Total usage: ~11-13GB out of 16GB = safe margin

#### 2. Whisper STT
```yaml
WHISPER_MODEL=distil-small.en
WHISPER_COMPUTE_TYPE=int8
CUDA_VISIBLE_DEVICES=0
```
- Uses ~1-2GB GPU memory
- INT8 quantization reduces memory footprint
- Shares GPU 0 with vLLM efficiently

#### 3. Kokoro TTS
```yaml
# CPU version - no GPU usage
image: ghcr.io/remsky/kokoro-fastapi-cpu:latest
```
- **Removed GPU runtime** (was incorrectly configured)
- Runs on CPU - fast enough for TTS
- Frees up GPU memory for vLLM and Whisper

## Expected Memory Usage

```
┌─────────────────────────────────────────┐
│  RTX 5070 Ti - 16GB VRAM                │
├─────────────────────────────────────────┤
│  vLLM Model:        ~5.5GB              │
│  vLLM KV Cache:     ~5.6GB (35%)        │
│  Whisper:           ~1.5GB              │
│  System Overhead:   ~1.0GB              │
│  ─────────────────────────────           │
│  TOTAL:            ~13.6GB / 16GB       │
│  FREE:             ~2.4GB (margin)      │
└─────────────────────────────────────────┘
```

## Performance Impact

### What Changed:
1. **Lower GPU utilization** (0.35 vs 0.6)
   - Slightly fewer cached tokens
   - Still handles 2048 token context (increased from 1024!)
   - Minimal impact on response quality

2. **Kokoro on CPU**
   - TTS is not computationally intensive
   - CPU is fast enough (~500ms-1s)
   - Frees GPU for LLM

3. **Shared GPU for vLLM + Whisper**
   - Both use CUDA_VISIBLE_DEVICES=0
   - They don't run simultaneously (pipeline is sequential)
   - Efficient time-slicing

## Troubleshooting

### Still Getting OOM?

**Option 1: Use smaller Whisper model**
```yaml
environment:
  - WHISPER_MODEL=tiny.en  # ~500MB vs ~1.5GB
```

**Option 2: Further reduce vLLM memory**
```yaml
command: >
  Qwen/Qwen3-8B-FP8
  --gpu-memory-utilization 0.25  # Even more conservative
```

**Option 3: Use smaller LLM**
```yaml
command: >
  Qwen/Qwen2-7B-Instruct  # Slightly smaller
  --gpu-memory-utilization 0.35
```

**Option 4: Reduce context length**
```yaml
--max-model-len 1024  # Smaller KV cache
```

### Monitor GPU Usage

```bash
# Real-time GPU monitoring
watch -n 1 nvidia-smi

# Check memory per process
nvidia-smi pmon -c 1
```

### Optimal Settings for Different GPUs

#### 8GB VRAM (RTX 3060, RTX 4060)
```yaml
vllm:
  command: >
    Qwen/Qwen2-7B-Instruct
    --gpu-memory-utilization 0.25
    --max-model-len 1024

whisper:
  environment:
    - WHISPER_MODEL=tiny.en
```

#### 12GB VRAM (RTX 3060 Ti, RTX 4070)
```yaml
vllm:
  command: >
    Qwen/Qwen3-8B-FP8
    --gpu-memory-utilization 0.30
    --max-model-len 1536

whisper:
  environment:
    - WHISPER_MODEL=distil-small.en
```

#### 16GB+ VRAM (RTX 5070 Ti, RTX 4080) ← Your GPU
```yaml
vllm:
  command: >
    Qwen/Qwen3-8B-FP8
    --gpu-memory-utilization 0.35
    --max-model-len 2048

whisper:
  environment:
    - WHISPER_MODEL=distil-small.en
```

#### 24GB+ VRAM (RTX 4090, RTX 6000)
```yaml
vllm:
  command: >
    Qwen/Qwen3-8B-FP8
    --gpu-memory-utilization 0.50
    --max-model-len 4096

whisper:
  environment:
    - WHISPER_MODEL=large-v3  # Best quality
```

## Advanced: Sequential Loading

If still facing issues, load services sequentially:

```bash
# 1. Start vLLM first
docker-compose up -d vllm
docker-compose logs -f vllm
# Wait for "Application startup complete"

# 2. Start Whisper
docker-compose up -d whisper
docker-compose logs -f whisper

# 3. Start TTS (CPU, no wait needed)
docker-compose up -d kokoro-tts

# 4. Start backend and frontend
docker-compose up -d websocket-backend frontend
```

## Verification Commands

```bash
# Check all services are running
docker-compose ps

# Check GPU memory usage
nvidia-smi

# Test vLLM
curl http://localhost:8000/v1/models

# Test Whisper
curl http://localhost:8001/health

# Test backend
curl http://localhost:8002/health
```

## Current Optimized Configuration

Your `docker-compose.yml` is now optimized for RTX 5070 Ti with:
- ✅ vLLM using 35% GPU memory (safe allocation)
- ✅ Increased context length to 2048 tokens
- ✅ Whisper using INT8 quantization
- ✅ Kokoro running on CPU (freed GPU memory)
- ✅ ~2.4GB safety margin

**Ready to start!** 🚀
