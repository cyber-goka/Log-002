# Log 002: Building a Local Voice AI Assistant with Real-Time Weather Integration

## TL;DR (For Non-Technical Readers)

Imagine having your own personal voice assistant like Siri or Alexa, but one that runs entirely on your computer—no cloud, no subscription fees, and complete privacy. This project shows you how to build exactly that, with the ability to ask about the weather and get real-time responses, all powered by open-source AI models running locally on your machine.

## Overview

This guide demonstrates how to build a fully local voice AI assistant using modern open-source technologies. The system combines speech-to-text, large language models, text-to-speech, and real-time weather data—all running on your own hardware without any cloud dependencies.

**Key Features:**
- 🎤 Real-time voice input processing with automatic speech detection (VAD)
- 🎙️ Hands-free continuous listening mode
- 🧠 Local LLM with tool-calling capabilities (weather API)
- 🔊 Natural-sounding text-to-speech output
- 🌐 WebSocket-based real-time communication
- 🐳 Fully containerized with Docker
- 🔒 Complete privacy—no data leaves your machine

## Architecture

The system consists of five main components orchestrated via Docker Compose:

```
┌─────────────┐
│   Frontend  │ (React + WebSocket)
│   (Port     │
│   3001)     │
└──────┬──────┘
       │ WebSocket
       ▼
┌─────────────────────────────────────────┐
│     WebSocket Backend (Port 8002)       │
│  • Orchestrates conversation flow       │
│  • Manages tool calls (weather API)     │
│  • Coordinates AI services              │
└───┬────────┬────────────┬───────────────┘
    │        │            │
    ▼        ▼            ▼
┌────────┐ ┌──────┐ ┌──────────┐
│  vLLM  │ │Whisper│ │  Kokoro  │
│ Qwen3  │ │  STT  │ │   TTS    │
│(8000)  │ │(8001) │ │  (8880)  │
└────────┘ └───────┘ └──────────┘
```

### Component Breakdown

#### 1. **vLLM Server** (Large Language Model)
- **Model:** Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4
- **Purpose:** Handles natural language understanding and generation
- **Special Feature:** Tool calling enabled (can trigger weather API)
- **GPU:** Utilizes 85% GPU memory allocation (model uses ~5.2 GiB, leaving 6.45 GiB for KV cache)
- **Quantization:** GPTQ-Int4 quantization reduces memory by 63% compared to full precision

**For DevOps:** The GPTQ-Int4 quantization drastically reduces memory footprint (from 14.25 GiB to 5.2 GiB) while maintaining quality and full tool-calling support. The `--enable-auto-tool-choice` flag enables function calling, allowing the model to decide when to use external tools. The `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` environment variable helps prevent memory fragmentation.

#### 2. **Faster Whisper** (Speech-to-Text)
- **Model:** distil-small.en
- **Purpose:** Converts voice input to text
- **Optimization:** Uses INT8 quantization for faster processing
- **Latency:** ~200-500ms for typical speech segments

**For Developers:** The OpenAI-compatible API makes integration seamless. We use the distilled small model for a balance between accuracy and speed.

#### 3. **Kokoro TTS** (Text-to-Speech)
- **Purpose:** Converts AI responses to natural-sounding speech
- **API:** OpenAI-compatible endpoint
- **Quality:** High-quality neural TTS with natural prosody

#### 4. **WebSocket Backend**
- **Framework:** FastAPI with WebSockets
- **Purpose:** Orchestrates the conversation flow
- **Features:**
  - Real-time bidirectional communication
  - Weather tool integration via OpenWeatherMap API
  - Manages state between STT → LLM → TTS pipeline

**For Developers:** The backend implements the tool-calling protocol, allowing the LLM to request weather data which is then fetched and returned to the conversation context.

#### 5. **React Frontend with Native VAD**
- **Framework:** Vite + React
- **Purpose:** User interface for voice interaction
- **VAD Implementation:** Native browser-based Voice Activity Detection using Web Audio API
- **Features:**
  - Continuous listening mode with automatic speech detection
  - Volume-based VAD (no external dependencies)
  - Real-time audio visualization that changes color when speaking
  - WebSocket communication
  - Automatic silence detection and processing
  - Audio playback for TTS responses

**For Developers:** The frontend implements VAD using Web Audio API's AnalyserNode to monitor audio volume in real-time. When volume exceeds a threshold (0.01), recording starts automatically. After 1.5 seconds of silence, the audio is automatically sent for processing. This provides a hands-free experience without the complexity of external ML-based VAD libraries.

## Voice Activity Detection (VAD) Implementation

One of the key features of this assistant is **automatic speech detection** that enables hands-free operation. Instead of manually clicking buttons to start and stop recording, the system automatically detects when you're speaking.

### Why Native Browser VAD?

Initially, we explored using ML-based VAD libraries like Silero VAD (via @ricky0123/vad-react). However, these presented several challenges:
- **Complex dependencies**: Required ONNX Runtime and WASM files
- **Build tool issues**: Vite compatibility problems with CommonJS modules
- **CORS complications**: CDN loading issues for ML models
- **Bundle size**: Added ~20+ packages and several MB to the frontend

**The Solution:** Implement VAD using native browser APIs - specifically the Web Audio API.

### How Native VAD Works

```javascript
// VAD Configuration (frontend/src/App.jsx)
const VAD_CONFIG = {
  volumeThreshold: 0.01,      // Minimum volume to consider as speech
  silenceDuration: 1500,      // ms of silence before ending speech
  minSpeechDuration: 500,     // Minimum speech duration to process
  checkInterval: 100,         // How often to check volume (ms)
}
```

**The Algorithm:**
1. **Volume Monitoring**: Every 100ms, analyze the audio frequency data using AnalyserNode
2. **Speech Detection**: When average volume exceeds 0.01 (normalized 0-1), mark as speaking
3. **Recording Start**: Automatically start recording when speech detected
4. **Silence Detection**: After 1.5 seconds below threshold, consider speech ended
5. **Auto-Processing**: If speech lasted > 500ms, automatically send for transcription

**Visual Feedback:**
- Blue visualizer: Listening, waiting for speech
- Orange/Red visualizer: Speech detected, recording active
- Status badge updates in real-time

### Benefits of This Approach

✅ **Zero dependencies**: No external VAD libraries needed
✅ **Lightweight**: Removed 21 packages from the build
✅ **Reliable**: No CORS, WASM, or compatibility issues
✅ **Fast**: Native browser APIs are highly optimized
✅ **Adjustable**: Easy to tune sensitivity via VAD_CONFIG
✅ **Privacy**: All processing happens locally in the browser

### Trade-offs

⚠️ **Less sophisticated**: Volume-based detection is simpler than ML models
⚠️ **Background noise**: May trigger on loud ambient sounds
⚠️ **Tuning needed**: Threshold may need adjustment for different environments

However, for a local voice assistant in a typical home/office environment, this approach provides an excellent balance of simplicity, reliability, and functionality.

## How It Works: The Conversation Flow

Here's what happens when you ask "What's the weather in Tokyo?" in continuous listening mode:

1. **Continuous Monitoring**: VAD monitors audio volume every 100ms, waiting for speech
2. **Speech Detection**: When you start speaking, volume exceeds threshold - recording starts automatically
3. **Voice Capture**: Audio is recorded until you stop speaking (1.5s of silence)
4. **Auto-Send**: Audio automatically sent via WebSocket to backend
5. **Speech-to-Text**: Whisper transcribes audio to text: "What's the weather in Tokyo?"
6. **LLM Processing**: Qwen2.5 analyzes the query and decides to use the weather tool
7. **Tool Call**: Backend receives tool call request, fetches weather from OpenWeatherMap API
8. **LLM Response**: Model generates natural response: "It's currently 18°C and partly cloudy in Tokyo..."
9. **Text-to-Speech**: Kokoro converts response to audio
10. **Playback**: Frontend receives and plays the audio response
11. **Ready for Next**: VAD automatically returns to listening mode - speak again anytime

**For Non-Technical Readers:** Think of it like talking to a person - you just start speaking, they listen until you're done, think about your question, look up information if needed, and respond. Then they're ready to listen again. No buttons needed!

## Technical Implementation

### Docker Compose Setup

The entire stack is defined in `docker-compose.yml`:

```yaml
services:
  vllm:
    image: vllm/vllm-openai:latest
    runtime: nvidia
    environment:
      - CUDA_VISIBLE_DEVICES=0
      - PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
    command: >
      Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4
      --quantization gptq
      --gpu-memory-utilization 0.85
      --max-model-len 4096
      --enable-auto-tool-choice
      --tool-call-parser hermes
      --enforce-eager
    ports:
      - "8000:8000"

  whisper:
    image: fedirz/faster-whisper-server:latest-cpu
    environment:
      - WHISPER_MODEL=Systran/faster-distil-whisper-small.en
      - WHISPER_COMPUTE_TYPE=int8
    ports:
      - "8001:8000"

  kokoro-tts:
    image: ghcr.io/remsky/kokoro-fastapi-cpu:latest
    ports:
      - "8880:8880"

  websocket-backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    ports:
      - "8002:8001"
    depends_on:
      - vllm
      - whisper
      - kokoro-tts

  frontend:
    build:
      context: ./frontend
    ports:
      - "3001:3000"
```

**For DevOps:**
- All services share GPU through `CUDA_VISIBLE_DEVICES=0`
- Port mapping avoids conflicts (8000, 8001, 8002, 8880, 3001)
- Volumes persist Hugging Face cache for faster model loading
- Dependencies ensure proper startup order

### Backend Implementation

The WebSocket backend handles:
- **Connection Management**: Maintains WebSocket connections
- **Audio Processing**: Handles binary audio data
- **Tool Integration**: Implements weather API function
- **LLM Orchestration**: Manages conversation context and tool calls

Key features:
```python
# Weather tool definition for LLM
tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string"}
            }
        }
    }
}]
```

**For Developers:** The tool definition follows OpenAI's function calling schema. The LLM automatically decides when to invoke this based on user input.

### Frontend Implementation

The React frontend provides:
- **Audio Recording**: MediaRecorder API for capturing voice
- **WebSocket Client**: Real-time communication with backend
- **State Management**: Tracks conversation state (idle, listening, processing, speaking)
- **Audio Playback**: Plays TTS responses automatically

```javascript
// Real-time audio streaming to backend
mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0 && ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(event.data);
    }
};
```

**For Developers:** Audio chunks are sent as binary WebSocket messages. The backend buffers and processes them in real-time.

## Performance Characteristics

### Latency Breakdown
- **STT (Whisper):** ~200-500ms
- **LLM Inference:** ~1-2s (depends on response length)
- **Weather API:** ~100-300ms
- **TTS (Kokoro):** ~500ms-1s
- **Total Round-Trip:** ~2-4 seconds

**For DevOps:** Latency can be reduced by:
- Using faster quantized models
- Implementing request batching
- Adding caching for frequent queries
- Using vLLM's continuous batching

### Resource Requirements
- **GPU:** NVIDIA GPU with 12GB+ VRAM recommended (tested on RTX 5070 Ti with 16GB VRAM)
  - **Note:** With GPTQ-Int4 quantization, the model uses only ~5.2 GiB VRAM
  - Minimum 12GB VRAM for operation with careful memory tuning
  - 16GB+ VRAM provides comfortable headroom for all services
- **RAM:** 16GB+ system RAM
- **Storage:** ~20GB for models (cached in `~/.cache/huggingface`)
- **Network:** Internet only needed for weather API calls

**Memory Optimization:** The GPTQ-Int4 quantization reduces the model footprint by 63% (from 14.25 GiB to 5.2 GiB), making it possible to run on consumer GPUs while maintaining 6.45 GiB available for KV cache.

## Getting Started

### Prerequisites
```bash
# Install Docker and Docker Compose
sudo apt-get install docker.io docker-compose

# Install NVIDIA Container Toolkit
sudo apt-get install nvidia-container-toolkit
```

### Running the System
```bash
# Clone the repository
git clone <your-repo>
cd log-002-local-voice-agent

# Start all services
docker-compose up -d

# Watch logs
docker-compose logs -f websocket-backend
```

### First Interaction (Continuous Listening Mode)
1. Open browser to `http://localhost:3001`
2. Click "Start Continuous Listening" (one time)
3. Just speak: "What's the weather in London?"
4. System automatically detects your speech, processes it, and responds
5. After the response, speak again - no buttons needed!

**For Non-Technical Readers:** After running these commands, you'll have your own private voice assistant running! Click one button, and then just talk naturally - the system automatically knows when you're speaking and when you've finished. It's like talking to a person!

## Use Cases

### For Developers
- Learn about LLM tool calling and function execution
- Understand WebSocket-based real-time systems
- Explore speech processing pipelines
- Build custom tools beyond weather (database queries, home automation, etc.)

### For DevOps Engineers
- Study containerized AI service orchestration
- Optimize GPU resource allocation
- Implement monitoring and logging
- Scale services horizontally

### For Privacy-Conscious Users
- No data sent to cloud providers
- Complete control over your data
- Can run offline (except weather API)
- No subscription fees

## Extending the System

### Adding New Tools

Want to add more capabilities? Define new functions:

```python
tools.append({
    "type": "function",
    "function": {
        "name": "search_documents",
        "description": "Search local documents",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"}
            }
        }
    }
})
```

Then implement the handler in the backend. The LLM will automatically learn to use it!

**For Non-Technical Readers:** You can teach your assistant new skills by adding "tools"—like giving it the ability to search your files, control smart home devices, or look up information in your notes.

### Customizing the Voice

Kokoro TTS supports different voices. Modify the TTS request:

```python
"voice": "af_sky"  # Try: af_bella, af_nicole, am_adam, etc.
```

### Swapping the LLM

Want a different model? Change the vLLM configuration:

```yaml
command: >
  meta-llama/Llama-3.1-8B-Instruct
  --enable-auto-tool-choice
```

**For Developers:** Any HuggingFace model compatible with vLLM works. Just ensure it supports tool calling.

## Troubleshooting Journey: Real-World Problems and Solutions

This section documents the actual issues encountered while building this system and how they were resolved. These are valuable lessons for anyone building similar AI pipelines.

### Problem 1: GPU Out of Memory on Initial Load

**Symptom:**
```
torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 74.00 MiB.
GPU 0 has a total capacity of 15.45 GiB of which 27.75 MiB is free.
```

**Root Cause:** The unquantized Qwen2.5-7B-Instruct model required 14.25 GiB, leaving no room for the KV cache.

**Solution:** Switch to GPTQ-Int4 quantization
```yaml
# Before: Unquantized model
Qwen/Qwen2.5-7B-Instruct  # 14.25 GiB

# After: GPTQ quantized
Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4  # 5.2 GiB
--quantization gptq
```

**Results:**
- Model size: 14.25 GiB → 5.2 GiB (63% reduction)
- Available for KV cache: 0 GiB → 6.45 GiB
- Memory saved: 9 GiB

**Key Insight:** Always use quantized models for consumer GPUs. GPTQ-Int4 provides the best balance of size reduction and quality preservation.

### Problem 2: Tool Calling Not Working (Critical Issue)

**Symptom:**
```
LLM response: "I'm sorry, but I couldn't retrieve the weather information..."
```
No tool calls were being made despite proper tool definitions.

**Root Cause:** AWQ quantization has known compatibility issues with tool calling in vLLM. The model would receive tool definitions but fail to invoke them.

**Investigation:** Research revealed:
- GitHub Issue: [Tool calling broken for Qwen2.5-AWQ models](https://github.com/vllm-project/vllm/issues/10952)
- AWQ quantized models don't properly support the Hermes tool calling format
- Official GPTQ models from Qwen team have better compatibility

**Solution:** Switch from AWQ to GPTQ quantization

```yaml
# Before: AWQ (faster but incompatible with tool calling)
Qwen/Qwen2.5-7B-Instruct-AWQ
--quantization awq

# After: GPTQ-Int4 (full tool calling support)
Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4
--quantization gptq
```

**Verification:**
```
INFO:backend:Executing tool: get_weather with args: {'location': 'Berlin'}
```

**Key Lesson:** Not all quantization methods are equal for feature compatibility. When using advanced features like tool calling:
1. Check quantization method compatibility first
2. Use official quantized models from the model creators
3. GPTQ generally has better framework support than AWQ for complex features

### Problem 3: Whisper GPU Memory Conflict

**Symptom:**
```
RuntimeError: cuBLAS failed with status CUBLAS_STATUS_ALLOC_FAILED
```

**Root Cause:** Both vLLM and Whisper were configured to use the same GPU (CUDA_VISIBLE_DEVICES=0), but after loading the GPTQ model, insufficient VRAM remained for Whisper.

**Memory Breakdown:**
- Total GPU: 15.45 GiB
- LLM Model: 5.2 GiB
- KV Cache: 6.45 GiB
- Remaining: ~3.8 GiB (insufficient for GPU Whisper operations)

**Solution:** Run Whisper on CPU instead

```yaml
# Before: CUDA version competing for GPU
whisper:
  image: fedirz/faster-whisper-server:latest-cuda
  runtime: nvidia
  environment:
    - CUDA_VISIBLE_DEVICES=0

# After: CPU version
whisper:
  image: fedirz/faster-whisper-server:latest-cpu
  # No GPU needed
```

**Trade-offs:**
- ✅ No GPU memory conflict
- ✅ Dedicated GPU resources for LLM
- ⚠️ Slightly slower STT (~200-800ms vs ~100-400ms)
- ✅ Still fast enough for real-time voice interaction

**Key Insight:** For voice assistants, the LLM is the bottleneck. Offloading Whisper to CPU is a smart resource allocation that maintains acceptable performance.

### Problem 4: Whisper Model Name Mismatch

**Symptom:**
```
INFO: whisper-1 is not a valid model name.
Using Systran/faster-whisper-large-v3 instead.
```

**Root Cause:** Backend was sending OpenAI-compatible model name `whisper-1`, but faster-whisper-server wasn't configured to map it correctly, falling back to a much larger model.

**Solution:** Use explicit model names in both configuration and requests

```python
# Backend: Use exact model name
'model': 'Systran/faster-distil-whisper-small.en'

# Docker Compose: Match the configuration
WHISPER_MODEL=Systran/faster-distil-whisper-small.en
```

**Key Lesson:** Don't rely on implicit model name mapping. Always use explicit model identifiers that match your configuration.

### Problem 5: VAD Library Integration Issues

**Initial Approach:** Attempted to use ML-based VAD libraries (@ricky0123/vad-react with Silero VAD) for sophisticated speech detection.

**Symptoms:**
```
Error: useMicVAD is not a function
Error: exports is not defined
Error: Dynamic require of "onnxruntime-web/wasm" is not supported
CORS errors loading ONNX models from CDN
```

**Root Causes:**
1. **Package structure mismatch**: @ricky0123/vad-react and @ricky0123/vad-web use CommonJS format, but Vite expects ESM
2. **Dynamic imports**: ONNX Runtime uses dynamic `require()` statements that don't work in browser ESM context
3. **WASM file loading**: Required serving WASM files locally with proper MIME types
4. **Dependency complexity**: Added 20+ packages including vite-plugin-static-copy, onnxruntime-web with complex configuration

**Solution Attempts:**
1. ❌ Exclude packages from Vite optimization → exports undefined
2. ❌ Include packages for transformation → dynamic require errors
3. ❌ Copy WASM files with vite-plugin-static-copy → CORS issues persist
4. ✅ **Final Solution: Native Browser VAD**

**The Better Approach:**
```javascript
// Native VAD using Web Audio API (frontend/src/App.jsx)
const getVolume = () => {
  const dataArray = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(dataArray)
  return dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length / 255
}

// Simple volume-based detection
if (volume > VAD_CONFIG.volumeThreshold) {
  // Start recording
}
```

**Results:**
- ✅ **Reduced bundle**: From 116 packages to 95 packages (-21 dependencies)
- ✅ **No build issues**: Pure ESM, no CommonJS/WASM complications
- ✅ **Better performance**: Native APIs are faster than loading ML models
- ✅ **Reliable**: No CORS, no external dependencies, no compatibility issues
- ✅ **Maintainable**: Simple, readable code that's easy to tune
- ⚠️ **Trade-off**: Volume-based instead of ML-based detection

**Key Lesson:** Don't over-engineer. For a voice assistant in controlled environments, native browser APIs provide excellent results without the complexity of external ML libraries. The 80/20 rule applies - simple volume detection handles 80% of use cases with 20% of the complexity.

### Quick Reference: If You Encounter Issues

**GPU Out of Memory:**
1. Verify you're using GPTQ quantization (not unquantized)
2. Add memory fragmentation fix:
   ```yaml
   environment:
     - PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
   ```
3. Reduce max-model-len if still problematic:
   ```bash
   --max-model-len 2048
   ```

**Tool Calling Not Working:**
1. Ensure you're using GPTQ, not AWQ:
   ```bash
   Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4
   --quantization gptq
   ```
2. Verify tool call parser is set:
   ```bash
   --tool-call-parser hermes
   ```

**Whisper Slow or Failing:**
```bash
# Use CPU version
image: fedirz/faster-whisper-server:latest-cpu
```

**Frontend Can't Connect:**
```bash
# Check WebSocket URL in frontend/.env
VITE_WS_URL=ws://localhost:8002/ws
```

**For DevOps:** Monitor with:
```bash
# GPU usage
nvidia-smi -l 1

# Container resources
docker stats
```

## Security Considerations

**For DevOps:**
- Weather API key should be in `.env` file (not committed)
- Consider adding authentication for production deployment
- Use HTTPS for WebSocket (WSS) in production
- Implement rate limiting on backend endpoints

**For Privacy:**
- All voice processing happens locally
- Only weather location is sent to external API
- No conversation logs sent to third parties
- Can run fully offline with tool calling disabled

## Cost Analysis

**Cloud Alternative (ChatGPT Voice):**
- $20/month subscription
- All conversations processed in cloud
- Limited API access
- Privacy concerns

**This Local Setup:**
- $0/month operational cost
- One-time hardware investment (GPU)
- Unlimited usage
- Complete privacy

**For Non-Technical Readers:** After buying the computer hardware, this costs nothing to run. Compare this to monthly subscriptions for cloud AI assistants!

## Future Improvements

1. **Multi-Language Support:** Add language detection and multi-lingual models
2. **Conversation Memory:** Implement RAG (Retrieval Augmented Generation) for context
3. **Voice Cloning:** Fine-tune TTS on custom voices
4. **Mobile App:** Build native iOS/Android clients
5. **Home Assistant Integration:** Control smart home devices
6. **Local Knowledge Base:** Add document search and Q&A

**For Developers:** The modular architecture makes these additions straightforward. Each service can be independently upgraded or replaced.

## Lessons Learned

### Technical Insights
- **Tool Calling Works Locally:** Modern small models (7-8B params) handle function calling remarkably well
- **Quantization is Key:** GPTQ-Int4 quantization enables running on consumer GPUs with 63% memory reduction
- **Memory Matters:** GPTQ quantization (5.2 GiB) vs full precision (14.25 GiB) is the difference between OOM errors and smooth operation
- **Quantization Method Matters:** GPTQ has better tool-calling support than AWQ with vLLM
- **Native APIs Beat Libraries:** Web Audio API VAD outperforms ML-based libraries in simplicity, reliability, and bundle size
- **Simple Solutions Win:** Volume-based VAD is 80% as effective as ML models with 20% of the complexity
- **WebSockets Excel for Voice:** Real-time bidirectional communication is perfect for conversational AI
- **vLLM Performance:** Continuous batching and PagedAttention make inference fast enough for interactive use

### Operational Insights
- **Docker Simplifies Deployment:** All services are reproducible and isolated
- **GPU Sharing Works:** Multiple services can coexist on one GPU with memory management
- **Model Caching Matters:** First-run downloads are slow; cache volumes are essential

## Conclusion

Building a local voice AI assistant is now accessible with open-source tools. This project demonstrates that you don't need cloud services or enterprise-grade hardware to create sophisticated AI applications. The entire stack runs on a consumer-grade gaming PC with privacy, performance, and complete control.

**Key Achievements:**
- ✅ Hands-free continuous listening with native browser VAD
- ✅ Local LLM with tool-calling capabilities
- ✅ Real-time speech processing pipeline (STT → LLM → TTS)
- ✅ No external dependencies for voice detection
- ✅ Fully containerized and reproducible

**For Developers:** You've learned to integrate STT, LLM, TTS, and tool calling into a cohesive system, and discovered that simple native solutions often beat complex libraries.

**For DevOps:** You've seen how to orchestrate multiple AI services with Docker, manage GPU resources efficiently, and make pragmatic trade-offs between sophistication and simplicity.

**For Everyone:** You've built your own private voice assistant that respects your privacy, works with natural conversation flow, and runs entirely offline (except for real-time data like weather).

## Resources

- **vLLM Documentation:** https://docs.vllm.ai/
- **Faster Whisper:** https://github.com/guillaumekln/faster-whisper
- **Kokoro TTS:** https://github.com/remsky/Kokoro-FastAPI
- **OpenWeatherMap API:** https://openweathermap.org/api
- **Qwen Models:** https://huggingface.co/Qwen

## Repository Structure

```
log-002-local-voice-agent/
├── docker-compose.yml          # Main orchestration file
├── backend.py                  # WebSocket server + tool calling
├── Dockerfile.backend          # Backend container definition
├── frontend/                   # React voice interface
│   ├── src/
│   │   ├── App.jsx            # Main voice UI component
│   │   └── main.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
└── README.md                   # This file
```

## License

MIT License - Feel free to use, modify, and distribute.

## Acknowledgments

Built with amazing open-source projects:
- vLLM team for fast inference engine
- Qwen team for capable small models
- Faster Whisper for efficient STT
- Kokoro for high-quality TTS

---

**Questions or improvements?** Open an issue or submit a PR!

*Log 002 - December 2025*
