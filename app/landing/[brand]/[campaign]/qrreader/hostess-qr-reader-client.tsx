'use client';

import React, { useState, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import {
  IconCamera,
  IconCheck,
  IconAlertCircle,
  IconLock,
  IconRefresh,
  IconArrowRight,
  IconX,
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
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successAttendee, setSuccessAttendee] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
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
    if (activeStreamRef.current) {
      activeStreamRef.current.getTracks().forEach((track) => track.stop());
      activeStreamRef.current = null;
    }
    setIsCameraOpen(false);
  }

  async function startCamera() {
    setErrorMessage(null);
    setIsCameraOpen(true);
    isHandlingScanRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      activeStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
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

      // Close camera immediately
      stopCamera();

      // Show full-screen success visual feedback
      const attendeeName = data.lead?.name || 'Attendee';
      setSuccessAttendee(attendeeName);

      // Auto redirect back to main [Scan QR Code] button after 2.5 seconds
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
      if (videoRef.current && isCameraOpen) {
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

  // 1. Password Screen
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl">
          <div className="flex items-center justify-center w-14 h-14 mx-auto mb-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-emerald-400">
            <IconLock size={28} />
          </div>
          <h1 className="text-xl font-bold text-center text-white mb-1">
            Hostess Check-in
          </h1>
          <p className="text-xs text-center text-neutral-400 mb-6">
            {campaignTitle || 'Grand Slam of Darts'}
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1">
                Hostess Password
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
                Passcode preset: <code className="text-emerald-400 font-mono select-all">{DEFAULT_HOSTESS_PASSWORD}</code>
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
              <span>Unlock</span>
              <IconArrowRight size={16} />
            </button>
          </form>
        </div>
      </main>
    );
  }

  // 2. Full-Screen Success Feedback Overlay ("successful, thank you bye")
  if (successAttendee) {
    return (
      <main className="fixed inset-0 z-50 bg-emerald-600 text-white flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in-95">
        <div className="w-24 h-24 rounded-full bg-white text-emerald-600 flex items-center justify-center mb-6 shadow-2xl animate-bounce">
          <IconCheck size={56} strokeWidth={3} />
        </div>
        <h2 className="text-3xl font-black uppercase tracking-wider mb-2">
          successful
        </h2>
        <p className="text-xl font-bold text-emerald-100 mb-4">
          thank you bye
        </p>
        <div className="px-4 py-2 bg-emerald-700/60 rounded-full text-sm font-medium text-white shadow-inner">
          ✓ {successAttendee} · Moved to Engaged
        </div>
      </main>
    );
  }

  // 3. Main Hostess Screen with Clean [Scan QR Code] Button
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col justify-between p-6">
      {/* Header */}
      <header className="text-center pt-6">
        <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-2">
          Hostess Station
        </span>
        <h1 className="text-2xl font-bold text-white">
          {campaignTitle || 'Grand Slam of Darts'}
        </h1>
        <p className="text-xs text-neutral-400 mt-1">
          Scan attendee contact cards to automatically move them to Engaged
        </p>
      </header>

      {/* Center Action Area */}
      <div className="flex flex-col items-center justify-center my-auto py-8">
        {errorMessage && (
          <div className="mb-6 p-4 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300 max-w-sm text-center flex items-center gap-2">
            <IconAlertCircle size={18} className="shrink-0 text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* The single [Scan QR Code] Button */}
        <button
          type="button"
          onClick={startCamera}
          className="w-full max-w-xs py-5 px-6 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-black text-lg uppercase tracking-wider rounded-2xl shadow-xl shadow-emerald-500/20 active:scale-95 transition-transform flex items-center justify-center gap-3"
        >
          <IconCamera size={26} strokeWidth={2.5} />
          <span>Scan QR Code</span>
        </button>
      </div>

      {/* Footer */}
      <footer className="text-center text-[11px] text-neutral-600 pb-2">
        Sales Lead Generator · Grand Slam Hostess Portal
      </footer>

      {/* Camera Fullscreen Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-40 bg-black flex flex-col">
          {/* Top Bar with Close button */}
          <div className="p-4 flex items-center justify-between text-white bg-black/60 backdrop-blur z-50">
            <span className="text-sm font-bold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Scanning QR Code...
            </span>
            <button
              type="button"
              onClick={stopCamera}
              className="p-2 bg-neutral-800 hover:bg-neutral-700 rounded-full text-white"
            >
              <IconX size={20} />
            </button>
          </div>

          {/* Camera Viewport */}
          <div className="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
            />
            <canvas ref={canvasRef} className="hidden" />

            {/* Target Reticle */}
            <div className="absolute w-64 h-64 border-2 border-emerald-400 rounded-2xl pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] flex flex-col justify-between p-2">
              <div className="flex justify-between">
                <span className="w-6 h-6 border-t-4 border-l-4 border-emerald-400 -mt-1 -ml-1 rounded-tl" />
                <span className="w-6 h-6 border-t-4 border-r-4 border-emerald-400 -mt-1 -mr-1 rounded-tr" />
              </div>
              <div className="flex justify-between">
                <span className="w-6 h-6 border-b-4 border-l-4 border-emerald-400 -mb-1 -ml-1 rounded-bl" />
                <span className="w-6 h-6 border-b-4 border-r-4 border-emerald-400 -mb-1 -mr-1 rounded-br" />
              </div>
            </div>

            {/* Processing Spinner */}
            {isProcessing && (
              <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-50">
                <IconRefresh className="animate-spin text-emerald-400" size={44} />
                <p className="text-base font-bold text-white">Recording Check-in...</p>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
