import { useCallback, useEffect, useRef, useState } from "react"

const SAMPLE_RATE = 16000
const BUFFER_SIZE = 4096

export interface WavChunk {
  id: string
  blob: Blob
  url: string
  duration: number
  timestamp: number
}

export type RecorderStatus = "idle" | "requesting" | "recording" | "paused"

interface UseRecorderOptions {
  chunkDuration?: number
  deviceId?: string
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeStr(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.round(input.length / ratio)
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const srcIndex = i * ratio
    const low = Math.floor(srcIndex)
    const high = Math.min(low + 1, input.length - 1)
    const frac = srcIndex - low
    output[i] = input[low] * (1 - frac) + input[high] * frac
  }
  return output
}

export function useRecorder(options: UseRecorderOptions = {}) {
  const { chunkDuration = 5, deviceId } = options

  const [status, setStatus] = useState<RecorderStatus>("idle")
  const [chunks, setChunks] = useState<WavChunk[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const samplesRef = useRef<Float32Array[]>([])
  const sampleCountRef = useRef(0)
  const chunkThreshold = SAMPLE_RATE * chunkDuration
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const pausedElapsedRef = useRef(0)
  const statusRef = useRef<RecorderStatus>("idle")

  statusRef.current = status

  const saveToOPFS = async (id: string, blob: Blob) => {
    try {
      const root = await navigator.storage.getDirectory()
      const fileHandle = await root.getFileHandle(id, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
    } catch (err) {
      console.error("Failed to save to OPFS", err)
    }
  }

  const deleteFromOPFS = async (id: string) => {
    try {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(id).catch(() => {})
    } catch (err) {}
  }

  const uploadChunk = async (id: string, blob: Blob) => {
    try {
      const formData = new FormData()
      formData.append("chunkId", id)
      formData.append("file", blob, `${id}.wav`)

      const res = await fetch("http://localhost:3000/api/chunks/upload", {
        method: "POST",
        body: formData,
      })
      if (res.ok) {
        // If uploaded successfully, checking if DB and bucket are in sync is done by the check API
        // For simplicity, we can delete from OPFS later during reconciliation or after some time.
        // Actually the prompt says: "chunks are only cleared after the bucket and DB are both confirmed in sync"
        // We'll leave it in OPFS until the reconciliation process clears it.
      }
    } catch (err) {
      console.error("Upload failed, keeping in OPFS", err)
    }
  }

  const flushChunk = useCallback(() => {
    if (samplesRef.current.length === 0) return

    const totalLen = samplesRef.current.reduce((n, b) => n + b.length, 0)
    const merged = new Float32Array(totalLen)
    let offset = 0
    for (const buf of samplesRef.current) {
      merged.set(buf, offset)
      offset += buf.length
    }
    samplesRef.current = []
    sampleCountRef.current = 0

    const blob = encodeWav(merged, SAMPLE_RATE)
    const url = URL.createObjectURL(blob)
    const id = crypto.randomUUID()
    const chunk: WavChunk = {
      id,
      blob,
      url,
      duration: merged.length / SAMPLE_RATE,
      timestamp: Date.now(),
    }
    setChunks((prev) => [...prev, chunk])
    
    // OPFS & Upload Pipeline
    saveToOPFS(id, blob).then(() => uploadChunk(id, blob))
  }, [])

  const start = useCallback(async () => {
    if (statusRef.current === "recording") return

    setStatus("requesting")
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
      })

      const audioCtx = new AudioContext()
      const source = audioCtx.createMediaStreamSource(mediaStream)
      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1)
      const nativeSampleRate = audioCtx.sampleRate

      processor.onaudioprocess = (e) => {
        if (statusRef.current !== "recording") return

        const input = e.inputBuffer.getChannelData(0)
        const resampled = resample(new Float32Array(input), nativeSampleRate, SAMPLE_RATE)

        samplesRef.current.push(resampled)
        sampleCountRef.current += resampled.length

        if (sampleCountRef.current >= chunkThreshold) {
          // flush synchronously from the collected buffers
          const totalLen = samplesRef.current.reduce((n, b) => n + b.length, 0)
          const merged = new Float32Array(totalLen)
          let off = 0
          for (const buf of samplesRef.current) {
            merged.set(buf, off)
            off += buf.length
          }
          samplesRef.current = []
          sampleCountRef.current = 0

          const blob = encodeWav(merged, SAMPLE_RATE)
          const url = URL.createObjectURL(blob)
          const id = crypto.randomUUID()
          const chunk: WavChunk = {
            id,
            blob,
            url,
            duration: merged.length / SAMPLE_RATE,
            timestamp: Date.now(),
          }
          setChunks((prev) => [...prev, chunk])

          // OPFS & Upload Pipeline
          saveToOPFS(id, blob).then(() => uploadChunk(id, blob))
        }
      }

      source.connect(processor)
      processor.connect(audioCtx.destination)

      streamRef.current = mediaStream
      audioCtxRef.current = audioCtx
      processorRef.current = processor
      setStream(mediaStream)

      samplesRef.current = []
      sampleCountRef.current = 0
      pausedElapsedRef.current = 0
      startTimeRef.current = Date.now()
      setElapsed(0)
      setStatus("recording")

      timerRef.current = setInterval(() => {
        if (statusRef.current === "recording") {
          setElapsed(
            pausedElapsedRef.current + (Date.now() - startTimeRef.current) / 1000
          )
        }
      }, 100)
    } catch {
      setStatus("idle")
    }
  }, [deviceId, chunkThreshold])

  const stop = useCallback(() => {
    flushChunk()

    processorRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (audioCtxRef.current?.state !== "closed") {
      audioCtxRef.current?.close()
    }
    if (timerRef.current) clearInterval(timerRef.current)

    processorRef.current = null
    audioCtxRef.current = null
    streamRef.current = null
    setStream(null)
    setStatus("idle")
  }, [flushChunk])

  const pause = useCallback(() => {
    if (statusRef.current !== "recording") return
    pausedElapsedRef.current += (Date.now() - startTimeRef.current) / 1000
    setStatus("paused")
  }, [])

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return
    startTimeRef.current = Date.now()
    setStatus("recording")
  }, [])

  const clearChunks = useCallback(() => {
    for (const c of chunks) {
      URL.revokeObjectURL(c.url)
      deleteFromOPFS(c.id)
    }
    setChunks([])
  }, [chunks])

  // Reconciliation process
  useEffect(() => {
    const doReconciliation = async () => {
      try {
        const root = await navigator.storage.getDirectory()
        const opfsIds: string[] = []
        for await (const name of root.keys()) {
          opfsIds.push(name)
        }
        if (opfsIds.length === 0) return

        const res = await fetch(`http://localhost:3000/api/chunks/check?ids=${opfsIds.join(",")}`)
        if (res.ok) {
           const { missing } = await res.json()
           const safeToDelete = opfsIds.filter(id => !missing.includes(id))
           
           // Upload missing ones
           for (const id of missing) {
             const fileHandle = await root.getFileHandle(id)
             const blob = await fileHandle.getFile()
             await uploadChunk(id, blob)
           }
           
           // Clear successfully synced ones
           for (const id of safeToDelete) {
             await deleteFromOPFS(id)
           }
        }
      } catch (e) {
        console.error("Reconciliation failed", e)
      }
    }

    const interval = setInterval(doReconciliation, 10000)
    return () => clearInterval(interval)
  }, [])

  // cleanup on unmount
  useEffect(() => {
    return () => {
      processorRef.current?.disconnect()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (audioCtxRef.current?.state !== "closed") {
        audioCtxRef.current?.close()
      }
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { status, start, stop, pause, resume, chunks, elapsed, stream, clearChunks }
}
