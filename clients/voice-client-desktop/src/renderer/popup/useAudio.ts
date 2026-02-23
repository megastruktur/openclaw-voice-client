/**
 * Audio recording hook using MediaRecorder API
 */

import { useState, useRef, useCallback } from 'react'

export interface UseAudioReturn {
  isRecording: boolean
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob | null>
  error: string | null
}

export function useAudio(deviceId?: string): UseAudioReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startRecording = useCallback(async () => {
    try {
      setError(null)

      // Request microphone access
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
      }
      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId }
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      })

      // Log audio track settings for diagnostics
      const audioTrack = stream.getAudioTracks()[0]
      if (audioTrack) {
        const settings = audioTrack.getSettings()
        console.log('[useAudio] Mic track:', audioTrack.label, 'settings:', JSON.stringify(settings))
      }

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      })

      chunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      mediaRecorder.start()
      mediaRecorderRef.current = mediaRecorder
      setIsRecording(true)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to start recording'
      setError(message)
      console.error('Recording error:', err)
    }
  }, [])

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || !isRecording) {
        resolve(null)
        return
      }

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        console.log(`[useAudio] Recording stopped: ${chunksRef.current.length} chunks, blob size: ${blob.size} bytes`)
        chunksRef.current = []
        if (mediaRecorderRef.current) {
          mediaRecorderRef.current.stream
            .getTracks()
            .forEach((track) => track.stop())
        }
        mediaRecorderRef.current = null
        setIsRecording(false)
        resolve(blob)
      }

      mediaRecorderRef.current.stop()
    })
  }, [isRecording])

  return {
    isRecording,
    startRecording,
    stopRecording,
    error,
  }
}
