'use client';

import React, { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import {
  IconCamera,
  IconCheck,
  IconAlertCircle,
  IconLock,
  IconRefresh,
  IconX,
  IconSparkles,
} from '@tabler/icons-react';
import { DEFAULT_HOSTESS_PASSWORD } from '@/lib/hostess-scan';

interface HostessQrReaderProps {
  brand: string;
  campaign: string;
  campaignTitle?: string;
}

export function HostessQrReaderClient({
  brand,
  campaign,
  campaignTitle,
}: HostessQrReaderProps) {
  const [password, setPassword] = useState(DEFAULT_HOSTESS_PASSWORD);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successAttendee, setSuccessAttendee] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const isHandlingScanRef = useRef(false);
  const processScannedPayloadRef = useRef<(data: string) => Promise<void>>(async () => {});

  // Check saved session auth
  useEffect(() => {
    const saved = sessionStorage.getItem(`hostess_auth_${brand}_${campaign}`);
    if (saved === DEFAULT_HOSTESS_PASSWORD) {
      setIsAuthenticated(true);
    }
  }, [brand, campaign]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (password.trim() === DEFAULT_HOSTESS_PASSWORD) {
      setIsAuthenticated(true);
      sessionStorage.setItem(`hostess_auth_${brand}_${campaign}`, password.trim());
      setErrorMessage(null);
    } else {
      setErrorMessage('Incorrect password. Please use the on-screen password.');
    }
  }

  function stopCamera() {
    if (animationFrameId.current) {
      cancelAnimationFrame(animationFrameId.current);
      animationFrameId.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        track.stop();
      });
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }

  async function startCamera() {
    // Ensure any existing stream is cleanly killed first
    stopCamera();

    setErrorMessage(null);
    setIsCameraActive(true);
    isHandlingScanRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        await videoRef.current.play();

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
                  return;
                }
              }
            }
          }
          animationFrameId.current = requestAnimationFrame(tick);
        }

        animationFrameId.current = requestAnimationFrame(tick);
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      stopCamera();
      setErrorMessage(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera permissions in Safari.'
          : 'Could not access camera. Please ensure no other app is using it.'
      );
    }
  }

  async function processScannedPayload(rawQrData: string) {
    setIsProcessing(true);
    setErrorMessage(null);

    // Immediate tactile feedback
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([150, 80, 150]);
    }

    try {
      const res = await fetch(`/api/landing/${brand}/${campaign}/hostess-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          qrContent: rawQrData,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to record hostess scan');
      }

      // Close camera immediately to release hardware
      stopCamera();

      // Show native full-screen success visual feedback
      const attendeeName = data.lead?.name || 'Attendee';
      setSuccessAttendee(attendeeName);

      // Auto-reset back to clean scan home after 2.5s
      setTimeout(() => {
        setSuccessAttendee(null);
        setIsProcessing(false);
        isHandlingScanRef.current = false;
      }, 2500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error processing QR code');
      setIsProcessing(false);
      // Resume scanning on error
      isHandlingScanRef.current = false;
      if (videoRef.current && isCameraActive) {
        animationFrameId.current = requestAnimationFrame(() => {});
      }
    }
  }

  useEffect(() => {
    processScannedPayloadRef.current = processScannedPayload;
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // 1. Password Screen (PWA Style)
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-[#0d1117] text-white flex flex-col justify-center items-center p-6 select-none">
        <div className="w-full max-w-sm bg-[#161b22] border border-white/10 rounded-3xl p-8 shadow-2xl backdrop-blur">
          <div className="flex items-center justify-center w-16 h-16 mx-auto mb-5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400">
            <IconLock size={32} />
          </div>
          <h1 className="text-2xl font-black text-center text-white tracking-tight mb-1">
            Hostess Check-in
          </h1>
          <p className="text-xs text-center text-neutral-400 mb-8 font-medium">
            {campaignTitle || 'Mr Vegas Grand Slam of Darts'}
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-[11px] font-bold text-neutral-300 uppercase tracking-wider mb-2">
                On-Screen Password
              </label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3.5 bg-black/50 border border-white/15 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                placeholder="Enter password"
                autoFocus
              />
              <p className="text-[11px] text-neutral-500 mt-2">
                Preset: <code className="text-emerald-400 font-mono select-all font-bold">{DEFAULT_HOSTESS_PASSWORD}</code>
              </p>
            </div>

            {errorMessage && (
              <div className="p-3 bg-red-950/50 border border-red-700/50 rounded-xl text-xs text-red-200 flex items-center gap-2">
                <IconAlertCircle size={16} className="shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 active:scale-98 text-neutral-950 font-black rounded-xl text-sm uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20"
            >
              Unlock Scanner
            </button>
          </form>
        </div>
      </main>
    );
  }

  // 2. Full-Screen Visual Feedback ("successful, thank you bye")
  if (successAttendee) {
    return (
      <main className="fixed inset-0 z-50 bg-[#00a862] text-white flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in zoom-in-95">
        <div className="w-28 h-28 rounded-full bg-white text-[#00a862] flex items-center justify-center mb-6 shadow-2xl animate-bounce">
          <IconCheck size={68} strokeWidth={3.5} />
        </div>
        <h1 className="text-4xl font-black uppercase tracking-wider mb-2">
          successful
        </h1>
        <p className="text-2xl font-bold text-emerald-100 mb-6">
          thank you bye
        </p>
        <div className="px-5 py-2.5 bg-black/20 backdrop-blur rounded-full text-sm font-semibold text-white shadow-inner flex items-center gap-2">
          <IconSparkles size={16} />
          <span>{successAttendee} · Moved to Engaged</span>
        </div>
      </main>
    );
  }

  // 3. Native PWA Hostess Dashboard Screen
  return (
    <main className="min-h-screen bg-[#0d1117] text-white flex flex-col justify-between p-6 select-none font-sans">
      {/* PWA Top Header */}
      <header className="text-center pt-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-bold tracking-wider uppercase mb-3">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Hostess Station</span>
        </div>
        <h1 className="text-2xl font-black tracking-tight text-white">
          {campaignTitle || 'Grand Slam of Darts'}
        </h1>
        <p className="text-xs text-neutral-400 mt-1.5">
          Scan attendee contact cards to auto-advance to Engaged
        </p>
      </header>

      {/* Center Action: The Single [Scan QR Code] Hero Button */}
      <div className="flex flex-col items-center justify-center my-auto py-10 w-full max-w-sm mx-auto">
        {errorMessage && (
          <div className="mb-6 p-4 bg-red-950/50 border border-red-700/50 rounded-2xl text-xs text-red-200 text-center flex items-center gap-2 w-full">
            <IconAlertCircle size={18} className="shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        <button
          type="button"
          onClick={startCamera}
          className="w-full py-6 px-8 bg-gradient-to-r from-emerald-500 to-emerald-400 active:scale-95 text-neutral-950 font-black text-xl uppercase tracking-wider rounded-3xl shadow-2xl shadow-emerald-500/30 transition-transform flex items-center justify-center gap-3.5 border-2 border-emerald-300/30"
        >
          <IconCamera size={32} strokeWidth={2.5} />
          <span>Scan QR Code</span>
        </button>
      </div>

      {/* PWA Bottom Status */}
      <footer className="text-center text-[11px] text-neutral-500 pb-4">
        Sales Lead Generator · Official Check-in PWA
      </footer>

      {/* FULLSCREEN ISOLATED CAMERA MODAL (Strictly 1 Single Viewport) */}
      {isCameraActive && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between">
          {/* Top Bar with Cancel Button */}
          <div className="p-5 flex items-center justify-between text-white bg-gradient-to-b from-black/80 to-transparent z-20">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-sm font-bold tracking-wide">Aim at Attendee QR Code</span>
            </div>
            <button
              type="button"
              onClick={stopCamera}
              className="w-10 h-10 rounded-full bg-white/20 active:bg-white/30 text-white flex items-center justify-center backdrop-blur transition-colors"
            >
              <IconX size={22} />
            </button>
          </div>

          {/* Singular Camera Video Layer (Covering middle square) */}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              muted
              playsInline
              webkit-playsinline="true"
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Glowing Reticle Target */}
            <div className="relative w-72 h-72 rounded-3xl border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] flex flex-col justify-between p-3 pointer-events-none">
              <div className="flex justify-between">
                <span className="w-8 h-8 border-t-4 border-l-4 border-emerald-400 -mt-1.5 -ml-1.5 rounded-tl-xl" />
                <span className="w-8 h-8 border-t-4 border-r-4 border-emerald-400 -mt-1.5 -mr-1.5 rounded-tr-xl" />
              </div>
              <div className="flex justify-between">
                <span className="w-8 h-8 border-b-4 border-l-4 border-emerald-400 -mb-1.5 -ml-1.5 rounded-bl-xl" />
                <span className="w-8 h-8 border-b-4 border-r-4 border-emerald-400 -mb-1.5 -mr-1.5 rounded-br-xl" />
              </div>
            </div>

            {/* Loading Spinner during Lead Update */}
            {isProcessing && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center gap-3 z-30">
                <IconRefresh className="animate-spin text-emerald-400" size={50} />
                <p className="text-lg font-black text-white uppercase tracking-wider">Moving to Engaged...</p>
              </div>
            )}
          </div>

          {/* Bottom Bar Info */}
          <div className="p-6 bg-gradient-to-t from-black/80 to-transparent text-center z-20">
            <p className="text-xs text-neutral-300 font-medium">
              Position the QR code inside the box to check in
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
