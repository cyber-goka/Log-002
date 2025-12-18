import asyncio
import json
import os
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import logging
from typing import Optional, Dict, Any, List
import base64

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration from environment
LLM_API_URL = os.getenv("LLM_API_URL", "http://localhost:8000/v1")
STT_API_URL = os.getenv("STT_API_URL", "http://localhost:8001/v1")
TTS_API_URL = os.getenv("TTS_API_URL", "http://localhost:8880/v1/audio/speech")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "")  # Get from OpenWeatherMap

# Tool definitions for LLM
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a specific location. Use this when the user asks about weather conditions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city name or location (e.g., 'Tokyo', 'London, UK', 'New York')"
                    }
                },
                "required": ["location"]
            }
        }
    }
]


class VoiceAssistant:
    """Orchestrates the voice AI pipeline: STT -> LLM -> TTS"""

    def __init__(self):
        self.conversation_history: List[Dict[str, str]] = []
        self.http_client = httpx.AsyncClient(timeout=60.0)

    async def transcribe_audio(self, audio_data: bytes) -> Optional[str]:
        """Convert audio to text using Whisper API"""
        try:
            files = {
                'file': ('audio.webm', audio_data, 'audio/webm')
            }
            # Enable VAD for better speech segmentation
            data = {
                'model': 'Systran/faster-distil-whisper-small.en',
                'response_format': 'json',
                'vad_filter': 'true',  # Enable Voice Activity Detection
                # VAD parameters for optimal speech detection
                'vad_parameters': json.dumps({
                    'threshold': 0.5,                 # Speech probability threshold
                    'min_speech_duration_ms': 250,    # Minimum speech duration
                    'min_silence_duration_ms': 500,   # Silence duration to split segments
                    'speech_pad_ms': 200,             # Padding around speech segments
                })
            }

            logger.info("Sending audio to STT service...")
            response = await self.http_client.post(
                f"{STT_API_URL}/audio/transcriptions",
                files=files,
                data=data
            )
            response.raise_for_status()

            result = response.json()
            text = result.get('text', '').strip()
            logger.info(f"Transcribed text: {text}")
            return text

        except Exception as e:
            logger.error(f"STT error: {e}")
            return None

    async def get_weather(self, location: str) -> str:
        """Fetch weather data from OpenWeatherMap API"""
        try:
            if not WEATHER_API_KEY:
                return "Weather API key not configured. Please set WEATHER_API_KEY environment variable."

            url = "http://api.openweathermap.org/data/2.5/weather"
            params = {
                "q": location,
                "appid": WEATHER_API_KEY,
                "units": "metric"  # Use Celsius
            }

            logger.info(f"Fetching weather for: {location}")
            response = await self.http_client.get(url, params=params)
            response.raise_for_status()

            data = response.json()

            # Extract relevant weather information
            weather = {
                "location": data["name"],
                "country": data["sys"]["country"],
                "temperature": data["main"]["temp"],
                "feels_like": data["main"]["feels_like"],
                "humidity": data["main"]["humidity"],
                "description": data["weather"][0]["description"],
                "wind_speed": data["wind"]["speed"]
            }

            # Format as natural text for LLM
            weather_text = (
                f"Current weather in {weather['location']}, {weather['country']}: "
                f"{weather['description']}. "
                f"Temperature: {weather['temperature']}°C (feels like {weather['feels_like']}°C). "
                f"Humidity: {weather['humidity']}%. "
                f"Wind speed: {weather['wind_speed']} m/s."
            )

            logger.info(f"Weather data: {weather_text}")
            return weather_text

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return f"Location '{location}' not found. Please check the city name."
            return f"Error fetching weather: {e}"
        except Exception as e:
            logger.error(f"Weather API error: {e}")
            return f"Unable to fetch weather data: {str(e)}"

    async def execute_tool_call(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        """Execute a tool function and return the result"""
        logger.info(f"Executing tool: {tool_name} with args: {arguments}")

        if tool_name == "get_weather":
            location = arguments.get("location", "")
            return await self.get_weather(location)
        else:
            return f"Unknown tool: {tool_name}"

    async def chat_with_llm(self, user_message: str) -> str:
        """Send message to LLM with tool calling support"""
        try:
            # Add user message to history
            self.conversation_history.append({
                "role": "user",
                "content": user_message
            })

            # Prepare the chat completion request
            payload = {
                "model": "Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4",
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a helpful voice assistant. Keep responses concise and natural for voice output. When the user asks about weather, use the get_weather tool to provide accurate current information."
                    },
                    *self.conversation_history
                ],
                "tools": TOOLS,
                "tool_choice": "auto",
                "temperature": 0.7,
                "max_tokens": 150
            }

            logger.info("Sending request to LLM...")
            response = await self.http_client.post(
                f"{LLM_API_URL}/chat/completions",
                json=payload
            )
            response.raise_for_status()

            result = response.json()
            message = result["choices"][0]["message"]

            # Check if LLM wants to call a tool
            if message.get("tool_calls"):
                tool_call = message["tool_calls"][0]
                function_name = tool_call["function"]["name"]
                function_args = json.loads(tool_call["function"]["arguments"])

                # Execute the tool
                tool_result = await self.execute_tool_call(function_name, function_args)

                # Add tool call to history
                self.conversation_history.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": message["tool_calls"]
                })

                # Add tool result to history
                self.conversation_history.append({
                    "role": "tool",
                    "tool_call_id": tool_call["id"],
                    "name": function_name,
                    "content": tool_result
                })

                # Make another LLM call with tool result
                payload["messages"] = [
                    {
                        "role": "system",
                        "content": "You are a helpful voice assistant. Keep responses concise and natural for voice output."
                    },
                    *self.conversation_history
                ]

                logger.info("Sending follow-up request to LLM with tool result...")
                response = await self.http_client.post(
                    f"{LLM_API_URL}/chat/completions",
                    json=payload
                )
                response.raise_for_status()
                result = response.json()
                message = result["choices"][0]["message"]

            # Get final assistant response
            assistant_message = message.get("content", "I'm not sure how to respond to that.")

            # Add assistant response to history
            self.conversation_history.append({
                "role": "assistant",
                "content": assistant_message
            })

            # Keep conversation history manageable (last 10 messages)
            if len(self.conversation_history) > 10:
                self.conversation_history = self.conversation_history[-10:]

            logger.info(f"LLM response: {assistant_message}")
            return assistant_message

        except Exception as e:
            logger.error(f"LLM error: {e}")
            return "I'm having trouble processing your request. Please try again."

    async def text_to_speech(self, text: str) -> Optional[bytes]:
        """Convert text to speech using Kokoro TTS"""
        try:
            payload = {
                "model": "kokoro",
                "input": text,
                "voice": "af_sky",  # Female voice (options: af_sky, af_bella, af_nicole, am_adam, am_michael)
                "response_format": "mp3",
                "speed": 1.0
            }

            logger.info(f"Converting to speech: {text[:50]}...")
            response = await self.http_client.post(
                TTS_API_URL,
                json=payload
            )
            response.raise_for_status()

            audio_data = response.content
            logger.info(f"Generated {len(audio_data)} bytes of audio")
            return audio_data

        except Exception as e:
            logger.error(f"TTS error: {e}")
            return None

    async def process_voice_input(self, audio_data: bytes) -> Optional[bytes]:
        """Complete pipeline: STT -> LLM -> TTS"""
        try:
            # Step 1: Transcribe audio to text
            text = await self.transcribe_audio(audio_data)
            if not text:
                logger.warning("No text transcribed from audio")
                return None

            # Step 2: Get LLM response (with potential tool calls)
            response_text = await self.chat_with_llm(text)

            # Step 3: Convert response to speech
            audio_response = await self.text_to_speech(response_text)

            return audio_response

        except Exception as e:
            logger.error(f"Pipeline error: {e}")
            return None

    async def cleanup(self):
        """Clean up resources"""
        await self.http_client.aclose()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time voice interaction"""
    await websocket.accept()
    logger.info("WebSocket connection established")

    assistant = VoiceAssistant()
    audio_buffer = bytearray()

    try:
        while True:
            # Receive data from client
            data = await websocket.receive()

            if "bytes" in data:
                # Accumulate audio data
                audio_buffer.extend(data["bytes"])
                logger.info(f"Received audio chunk: {len(data['bytes'])} bytes (total: {len(audio_buffer)})")

            elif "text" in data:
                message = json.loads(data["text"])

                if message.get("type") == "audio_end":
                    # Client finished sending audio
                    logger.info(f"Processing complete audio: {len(audio_buffer)} bytes")

                    if len(audio_buffer) > 0:
                        # Send status update
                        await websocket.send_json({
                            "type": "status",
                            "status": "processing"
                        })

                        # Process the complete audio
                        audio_response = await assistant.process_voice_input(bytes(audio_buffer))

                        # Clear buffer
                        audio_buffer.clear()

                        if audio_response:
                            # Send audio response back to client
                            logger.info(f"Sending audio response to client: {len(audio_response)} bytes")
                            try:
                                await websocket.send_json({
                                    "type": "audio_response",
                                    "audio": base64.b64encode(audio_response).decode('utf-8'),
                                    "format": "mp3"
                                })
                                logger.info("Audio response sent successfully")
                            except Exception as e:
                                logger.error(f"Failed to send audio response: {e}")
                        else:
                            logger.warning("No audio response generated")
                            await websocket.send_json({
                                "type": "error",
                                "message": "Failed to process audio"
                            })

                        # Send ready status
                        logger.info("Sending ready status")
                        await websocket.send_json({
                            "type": "status",
                            "status": "ready"
                        })
                        logger.info("Ready status sent")

                elif message.get("type") == "reset":
                    # Reset conversation
                    assistant.conversation_history.clear()
                    audio_buffer.clear()
                    await websocket.send_json({
                        "type": "status",
                        "status": "reset_complete"
                    })
                    logger.info("Conversation reset")

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await assistant.cleanup()


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "voice-assistant-backend"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
