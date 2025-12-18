import { useState, useRef, useEffect } from 'react'
import './App.css'

function App() {
  const [status, setStatus] = useState('disconnected') // disconnected, ready, listening, speaking, processing
  const [vadActive, setVadActive] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')

  const wsRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const animationFrameRef = useRef(null)
  const vadIntervalRef = useRef(null)
  const speechTimeoutRef = useRef(null)
  const isSpeakingRef = useRef(false)
  const audioStreamRef = useRef(null)

  // VAD Configuration
  const VAD_CONFIG = {
    volumeThreshold: 0.01,      // Minimum volume to consider as speech
    silenceDuration: 1500,      // ms of silence before considering speech ended
    minSpeechDuration: 500,     // Minimum ms of speech before processing
    checkInterval: 100,         // How often to check volume (ms)
  }

  const speechStartTimeRef = useRef(null)

  // WebSocket URL from environment or default
  const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8002/ws'

  useEffect(() => {
    connectWebSocket()
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current)
      }
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current)
      }
    }
  }, [])

  const connectWebSocket = () => {
    try {
      const ws = new WebSocket(WS_URL)

      ws.onopen = () => {
        console.log('WebSocket connected')
        setStatus('ready')
        setError('')
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          console.log('Received:', data)

          if (data.type === 'status') {
            setStatus(data.status)
          } else if (data.type === 'audio_response') {
            setStatus('speaking')
            playAudioResponse(data.audio)
          } else if (data.type === 'error') {
            setError(data.message)
            setStatus('ready')
          }
        } catch (e) {
          console.error('Error parsing message:', e)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        setError('Connection error. Please check if the backend is running.')
        setStatus('disconnected')
      }

      ws.onclose = () => {
        console.log('WebSocket disconnected')
        setStatus('disconnected')
        setTimeout(connectWebSocket, 3000)
      }

      wsRef.current = ws
    } catch (e) {
      console.error('Failed to connect:', e)
      setError('Failed to connect to server')
    }
  }

  const getVolume = () => {
    if (!analyserRef.current) return 0

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
    analyserRef.current.getByteFrequencyData(dataArray)

    // Calculate average volume
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i]
    }
    const average = sum / dataArray.length / 255 // Normalize to 0-1

    return average
  }

  const checkVAD = () => {
    const volume = getVolume()
    const isSpeakingNow = volume > VAD_CONFIG.volumeThreshold

    // Speech started
    if (isSpeakingNow && !isSpeakingRef.current) {
      console.log('Speech detected! Volume:', volume)
      isSpeakingRef.current = true
      setIsSpeaking(true)
      speechStartTimeRef.current = Date.now()

      // Clear any existing silence timeout
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current)
        speechTimeoutRef.current = null
      }

      // Start recording
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        startRecording()
      }
    }

    // Speech continuing
    if (isSpeakingNow && isSpeakingRef.current) {
      // Reset silence timeout
      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current)
      }
      speechTimeoutRef.current = setTimeout(() => {
        console.log('Silence detected - stopping recording')
        const speechDuration = Date.now() - speechStartTimeRef.current

        // Only process if speech was long enough
        if (speechDuration >= VAD_CONFIG.minSpeechDuration) {
          stopRecording()
        }

        isSpeakingRef.current = false
        setIsSpeaking(false)
        speechStartTimeRef.current = null
      }, VAD_CONFIG.silenceDuration)
    }
  }

  const toggleVAD = async () => {
    if (!vadActive) {
      // Start VAD listening
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        })

        audioStreamRef.current = stream

        // Setup audio context for volume detection
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext()
        }

        analyserRef.current = audioContextRef.current.createAnalyser()
        const source = audioContextRef.current.createMediaStreamSource(stream)
        source.connect(analyserRef.current)
        analyserRef.current.fftSize = 2048
        analyserRef.current.smoothingTimeConstant = 0.8

        // Start volume visualization
        visualize()

        // Start VAD checking
        vadIntervalRef.current = setInterval(checkVAD, VAD_CONFIG.checkInterval)

        setVadActive(true)
        setStatus('listening')
        setTranscript('Listening... Speak to start')
        setError('')
      } catch (e) {
        console.error('Failed to start VAD:', e)
        setError('Microphone access denied. Please allow microphone access.')
      }
    } else {
      // Stop VAD listening
      if (vadIntervalRef.current) {
        clearInterval(vadIntervalRef.current)
        vadIntervalRef.current = null
      }

      if (speechTimeoutRef.current) {
        clearTimeout(speechTimeoutRef.current)
        speechTimeoutRef.current = null
      }

      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop())
        audioStreamRef.current = null
      }

      // Stop any ongoing recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }

      setVadActive(false)
      setIsSpeaking(false)
      isSpeakingRef.current = false
      setStatus('ready')
      setTranscript('')
    }
  }

  const startRecording = async () => {
    try {
      if (!audioStreamRef.current) return

      const stream = audioStreamRef.current

      // Setup media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      })

      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        console.log('Audio blob size:', audioBlob.size)

        // Only send if we have meaningful audio
        if (audioBlob.size > 1000) {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            setTranscript('Processing...')

            // Send the audio blob
            const arrayBuffer = await audioBlob.arrayBuffer()
            wsRef.current.send(arrayBuffer)

            // Signal end of audio
            wsRef.current.send(JSON.stringify({ type: 'audio_end' }))
          }
        } else {
          console.log('Audio too short, ignoring')
          if (vadActive) {
            setTranscript('Listening... Speak to start')
          }
        }

        audioChunksRef.current = []
      }

      mediaRecorder.start(100)
      mediaRecorderRef.current = mediaRecorder
      setTranscript('Listening to you...')

    } catch (e) {
      console.error('Error starting recording:', e)
      setError('Failed to start recording')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const playAudioResponse = async (base64Audio) => {
    try {
      console.log('Decoding audio response, length:', base64Audio.length)

      const binaryString = atob(base64Audio)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)

      const audio = new Audio(url)

      audio.onended = () => {
        console.log('Audio playback ended')
        setStatus(vadActive ? 'listening' : 'ready')
        setTranscript(vadActive ? 'Listening... Speak to start' : '')
        URL.revokeObjectURL(url)
      }

      audio.onerror = (e) => {
        console.error('Audio playback error:', e, audio.error)
        setError(`Failed to play audio: ${audio.error?.message || 'Unknown error'}`)
        setStatus(vadActive ? 'listening' : 'ready')
        URL.revokeObjectURL(url)
      }

      try {
        await audio.play()
        console.log('Audio play() succeeded')
      } catch (playError) {
        console.error('Play was prevented:', playError)
        setError(`Autoplay blocked: ${playError.message}`)
        setStatus(vadActive ? 'listening' : 'ready')
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      console.error('Error in playAudioResponse:', e)
      setError(`Failed to process audio: ${e.message}`)
      setStatus(vadActive ? 'listening' : 'ready')
    }
  }

  const visualize = () => {
    const canvas = document.getElementById('visualizer')
    if (!canvas || !analyserRef.current) return

    const ctx = canvas.getContext('2d')
    const bufferLength = analyserRef.current.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      if (!vadActive) return
      animationFrameRef.current = requestAnimationFrame(draw)

      analyserRef.current.getByteFrequencyData(dataArray)

      ctx.fillStyle = 'rgba(0, 0, 0, 0.1)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const barWidth = (canvas.width / bufferLength) * 2.5
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height * 0.8

        const hue = isSpeaking ? 20 : (i / bufferLength) * 360
        const saturation = isSpeaking ? 100 : 80
        ctx.fillStyle = `hsl(${hue}, ${saturation}%, 50%)`
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight)

        x += barWidth + 1
      }
    }

    draw()
  }

  const resetConversation = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset' }))
      setTranscript(vadActive ? 'Listening... Speak to start' : '')
      setError('')
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'ready': return '#4CAF50'
      case 'listening': return isSpeaking ? '#FF5722' : '#2196F3'
      case 'processing': return '#FF9800'
      case 'speaking': return '#9C27B0'
      case 'disconnected': return '#F44336'
      default: return '#666'
    }
  }

  const getStatusText = () => {
    if (status === 'listening' && isSpeaking) {
      return 'Speaking Detected'
    }
    switch (status) {
      case 'ready': return 'Ready'
      case 'listening': return 'Listening...'
      case 'processing': return 'Processing...'
      case 'speaking': return 'Speaking...'
      case 'disconnected': return 'Disconnected'
      default: return status
    }
  }

  return (
    <div className="app">
      <div className="container">
        <header>
          <h1>Local Voice AI Assistant with VAD</h1>
          <div className="status-badge" style={{ backgroundColor: getStatusColor() }}>
            {getStatusText()}
          </div>
        </header>

        <div className="visualizer-container">
          <canvas id="visualizer" width="600" height="150"></canvas>
        </div>

        <div className="controls">
          {status !== 'disconnected' && !isSpeaking && status !== 'processing' && status !== 'speaking' && (
            <button
              className={vadActive ? "stop-button" : "record-button"}
              onClick={toggleVAD}
            >
              {vadActive ? (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <rect x="6" y="6" width="12" height="12"/>
                  </svg>
                  Stop Listening
                </>
              ) : (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                  Start Continuous Listening
                </>
              )}
            </button>
          )}

          {(status === 'processing' || status === 'speaking' || (vadActive && isSpeaking)) && (
            <button className="processing-button" disabled>
              <div className="spinner"></div>
              {getStatusText()}
            </button>
          )}
        </div>

        <div className="info-panel">
          <div className="info-section">
            <h3>Instructions (Volume-Based VAD)</h3>
            <ul>
              <li>Click "Start Continuous Listening" once</li>
              <li>Speak naturally - system detects volume above threshold</li>
              <li>Automatically processes after 1.5s of silence</li>
              <li>Wait for AI response, then speak again</li>
            </ul>
          </div>

          <div className="info-section">
            <h3>Features</h3>
            <ul>
              <li>Native browser VAD (no external libs)</li>
              <li>Local LLM (Qwen 2.5 7B GPTQ)</li>
              <li>Real-time weather information</li>
              <li>Natural voice synthesis</li>
              <li>100% local processing</li>
            </ul>
          </div>
        </div>

        {transcript && (
          <div className="transcript-box">
            <strong>Status:</strong> {transcript}
          </div>
        )}

        {error && (
          <div className="error-message">
            <strong>Error:</strong> {error}
          </div>
        )}

        <div className="action-buttons">
          <button className="reset-button" onClick={resetConversation}>
            Reset Conversation
          </button>
          <button className="reconnect-button" onClick={connectWebSocket}>
            Reconnect
          </button>
        </div>

        <footer>
          <p>
            Powered by vLLM (Qwen 2.5), Faster Whisper, and Kokoro TTS
          </p>
          <p className="privacy-note">
            All processing happens locally on your machine
          </p>
        </footer>
      </div>
    </div>
  )
}

export default App
