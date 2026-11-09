'use client';

import React, { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import {
  IconCamera,
  IconCheck,
  IconAlertCircle,
  IconLock,
  IconScan,
  IconRefresh,
  IconUserCheck,
  IconArrowRight,
  IconUpload,
} from '@tabler/icons-react';

interface HostessQrReaderProps {
  brand: string;
  campaign: string;
  campaignTitle?: string;
}

interface ScanResult {
  name: string;
  email?: string;
  phone?: string;
  kanbanColumn: string;
  tags?: string[];
  timestamp: string;
}

const DEFAULT_ON_SCREEN_PASSWORD = 'iamthevegashostess2026';

export function HostessQrReaderClient({
  brand,
  campaign,
  campaignTitle,
}: HostessQrReaderProps) {
  const [password, setPassword] = useState(DEFAULT_ON_SCREEN_PASSWORD);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [lastScannedResult, setLastScannedResult] = useState<ScanResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [manualNote, setManualNote] = useState('');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number | null>(null);
  const isHandlingScanRef = useRef(false);

  // Check saved session auth
  useEffect(() => {
    const saved = sessionStorage.getItem(`hostess_auth_${brand}_${campaign}`);
    if (saved === DEFAULT_ON_SCREEN_PASSWORD) {
      setIsAuthenticated(true);
    }
  }, [brand, campaign]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (password.trim() === DEFAULT_ON_SCREEN_PASSWORD) {
      setIsAuthenticated(true);
      sessionStorage.setItem(`hostess_auth_${brand}_${campaign}`, password.trim());
      setErrorMessage(null);
    } else {
      setErrorMessage('Incorrect password. Please use the on-screen password.');
    }
  }

  // Enumerate cameras when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    async function getCameras() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter((d) => d.kind === 'videoinput');
        setVideoDevices(cameras);
        if (cameras.length > 0 && !selectedDeviceId) {
          // Default to back/environment facing camera if found
          const backCam = cameras.find((c) => /back|rear|environment/i.test(c.label));
          setSelectedDeviceId(backCam ? backCam.deviceId : cameras[0].deviceId);
        }
      } catch {
        // Enumerate not permitted until first getUserMedia call
      }
    }
    getCameras();
  }, [isAuthenticated, selectedDeviceId]);

  const processScannedPayloadRef = useRef<(data: string) => Promise<void>>(async () => {});

  async function processScannedPayload(rawQrData: string) {
    setIsProcessing(true);
    setErrorMessage(null);

    // Audio / vibration feedback
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([100, 50, 100]);
    }

    try {
      const res = await fetch(`/api/landing/${brand}/${campaign}/hostess-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          qrContent: rawQrData,
          hostessNote: manualNote.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to process hostess scan');
      }

      const scanEntry: ScanResult = {
        name: data.lead?.name || 'Attendee',
        email: data.lead?.email,
        phone: data.lead?.phone,
        kanbanColumn: data.lead?.kanbanColumn || 'ENGAGED',
        tags: data.lead?.tags,
        timestamp: new Date().toLocaleTimeString(),
      };

      setLastScannedResult(scanEntry);
      setScanHistory((prev) => [scanEntry, ...prev.slice(0, 19)]);
      setManualNote('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Error processing QR code');
    } finally {
      setIsProcessing(false);
      // Debounce before allowing next scan (2.5 seconds)
      setTimeout(() => {
        isHandlingScanRef.current = false;
      }, 2500);
    }
  }

  useEffect(() => {
    processScannedPayloadRef.current = processScannedPayload;
  });

  // Start / stop camera stream
  useEffect(() => {
    if (!isAuthenticated) return;

    let activeStream: MediaStream | null = null;
    let localAnimationFrameId: number | null = null;

    function tick() {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth',
            });

            if (code && code.data && !isHandlingScanRef.current) {
              isHandlingScanRef.current = true;
              processScannedPayloadRef.current(code.data);
            }
          }
        }
      }

      localAnimationFrameId = requestAnimationFrame(tick);
      animationFrameId.current = localAnimationFrameId;
    }

    async function startCamera() {
      setCameraError(null);
      setIsScanning(true);

      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : { facingMode: { ideal: 'environment' } },
        audio: false,
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        activeStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true'); // Required for iOS Safari
          await videoRef.current.play();
          localAnimationFrameId = requestAnimationFrame(tick);
          animationFrameId.current = localAnimationFrameId;
        }
      } catch (err: any) {
        console.error('Camera access error:', err);
        setCameraError(
          err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Please allow camera access or use photo upload below.'
            : 'Unable to start camera. Please ensure another app is not using it.'
        );
        setIsScanning(false);
      }
    }

    startCamera();

    return () => {
      if (localAnimationFrameId) {
        cancelAnimationFrame(localAnimationFrameId);
      }
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isAuthenticated, selectedDeviceId]);

  // Handle fallback file upload
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code && code.data) {
          processScannedPayload(code.data);
        } else {
          setErrorMessage('No QR code detected in the uploaded image. Please try a clearer photo.');
        }
      }
    };
    img.src = URL.createObjectURL(file);
  }

  // 1. Password Screen
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-center w-14 h-14 mx-auto mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400">
            <IconLock size={28} />
          </div>
          <h1 className="text-xl font-bold text-center text-white mb-1">
            Hostess QR Scanner
          </h1>
          <p className="text-xs text-center text-neutral-400 mb-6">
            {campaignTitle || 'Grand Slam of Darts'} · Event Check-in
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Enter On-Screen Hostess Password
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-neutral-950 border border-neutral-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                placeholder="Enter password"
                autoFocus
              />
              <p className="text-[11px] text-neutral-500 mt-1.5">
                Passcode preset: <code className="text-emerald-400 select-all font-mono">iamthevegashostess2026</code>
              </p>
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg text-xs text-red-300 flex items-center gap-2">
                <IconAlertCircle size={16} className="shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              <span>Unlock Scanner</span>
              <IconArrowRight size={16} />
            </button>
          </form>
        </div>
      </main>
    );
  }

  // 2. Active Scanner Screen
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      {/* Top Bar */}
      <header className="px-4 py-3 bg-neutral-900/80 backdrop-blur border-b border-neutral-800 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">
              Hostess QR Scanner
            </h1>
            <p className="text-[11px] text-neutral-400">
              {campaignTitle || 'Grand Slam of Darts'} · Auto-moves to Engaged
            </p>
          </div>
        </div>

        {videoDevices.length > 1 && (
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            className="text-xs bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-neutral-200"
          >
            {videoDevices.map((d, idx) => (
              <option key={d.deviceId || idx} value={d.deviceId}>
                {d.label || `Camera ${idx + 1}`}
              </option>
            ))}
          </select>
        )}
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-4 max-w-lg mx-auto w-full gap-4">
        {/* Camera Viewport */}
        <div className="relative aspect-square w-full rounded-2xl overflow-hidden bg-black border-2 border-neutral-800 flex items-center justify-center shadow-inner">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Aiming Reticle Overlay */}
          <div className="absolute inset-8 border-2 border-emerald-500/70 rounded-2xl pointer-events-none flex flex-col justify-between p-2">
            <div className="flex justify-between">
              <span className="w-4 h-4 border-t-2 border-l-2 border-emerald-400 -mt-2 -ml-2 rounded-tl" />
              <span className="w-4 h-4 border-t-2 border-r-2 border-emerald-400 -mt-2 -mr-2 rounded-tr" />
            </div>
            <div className="flex justify-between">
              <span className="w-4 h-4 border-b-2 border-l-2 border-emerald-400 -mb-2 -ml-2 rounded-bl" />
              <span className="w-4 h-4 border-b-2 border-r-2 border-emerald-400 -mb-2 -mr-2 rounded-br" />
            </div>
          </div>

          {/* Processing Indicator */}
          {isProcessing && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-20">
              <IconRefresh className="animate-spin text-emerald-400" size={36} />
              <p className="text-sm font-semibold text-white">Updating SLG Pipeline...</p>
            </div>
          )}

          {/* Camera Error / Fallback */}
          {cameraError && (
            <div className="absolute inset-0 bg-neutral-900 p-6 flex flex-col items-center justify-center text-center gap-3 z-10">
              <IconAlertCircle className="text-amber-400" size={36} />
              <p className="text-xs text-neutral-300">{cameraError}</p>
              <label className="cursor-pointer px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2">
                <IconUpload size={16} />
                <span>Upload QR Photo</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>

        {/* Optional Hostess Note */}
        <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3">
          <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
            Optional Interaction Note (Appended to Next Scanned Lead)
          </label>
          <input
            type="text"
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
            placeholder="e.g. Interested in VIP booth package, handed physical merchandise"
            className="w-full px-3 py-2 bg-neutral-950 border border-neutral-800 rounded-lg text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Last Scan Result Card */}
        {lastScannedResult && (
          <div className="bg-emerald-950/40 border border-emerald-700/60 rounded-xl p-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <IconCheck size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {lastScannedResult.name}
                  </h3>
                  <p className="text-xs text-emerald-300">
                    {lastScannedResult.email || lastScannedResult.phone || 'Contact Saved'}
                  </p>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500 text-neutral-950">
                {lastScannedResult.kanbanColumn}
              </span>
            </div>

            <div className="mt-3 pt-3 border-t border-emerald-800/40 flex items-center justify-between text-[11px] text-neutral-400">
              <span className="flex items-center gap-1 text-emerald-400">
                <IconUserCheck size={14} />
                <span>Card accepted · Pipeline Engaged</span>
              </span>
              <span>{lastScannedResult.timestamp}</span>
            </div>
          </div>
        )}

        {/* Fallback Upload Action */}
        <div className="flex items-center justify-between text-xs text-neutral-400 pt-2">
          <span>Camera not focusing?</span>
          <label className="cursor-pointer text-emerald-400 hover:text-emerald-300 font-semibold flex items-center gap-1">
            <IconUpload size={14} />
            <span>Upload Photo of Badge</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Scan History */}
        {scanHistory.length > 0 && (
          <div className="mt-2">
            <h4 className="text-xs font-semibold text-neutral-400 mb-2 flex items-center gap-1.5">
              <IconScan size={14} />
              <span>Session Scanned Attendees ({scanHistory.length})</span>
            </h4>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {scanHistory.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-semibold text-white mr-2">{item.name}</span>
                    <span className="text-[11px] text-neutral-400">{item.email || item.phone}</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    {item.timestamp}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
