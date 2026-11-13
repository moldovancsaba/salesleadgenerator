'use client';

/**
 * Check-in reader for event staff. Screens: unlock (access code verified by the server with `verifyOnly`),
 * station (count of check-ins on this phone), and a full-screen camera that stays open between scans.
 * Each scan posts the QR content to `/api/landing/[brand]/[campaign]/hostess-scan`; the result (checked in,
 * already checked in, not checked in) covers the camera and clears itself or on tap. The same code is ignored for
 * a few seconds so a badge held in view is not scanned twice. Styling is Mantine and inline styles: Tailwind is not
 * installed in this app.
 */

import { EVENT_PASS_COLORS } from '@/lib/theme/event-pass-colors';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { ActionIcon, Box, Button, Paper, Stack, Text, TextInput } from '@mantine/core';
import {
  IconAlertCircle,
  IconBolt,
  IconBoltOff,
  IconCamera,
  IconCheck,
  IconLock,
  IconRefresh,
  IconUserCheck,
  IconX,
} from '@tabler/icons-react';
import { columnLabel, scanFailureMessage } from '@/lib/hostess-scan';
import type { PublicScannerConfig } from '@/lib/landing-page-schema';

interface HostessQrReaderProps {
  brand: string;
  campaign: string;
  campaignTitle?: string;
  scanner: PublicScannerConfig;
}

type ScanResult =
  | { kind: 'success'; name: string; column: string }
  | { kind: 'repeat'; name: string; column: string }
  | { kind: 'error'; message: string };

type CameraState = 'off' | 'starting' | 'on';

const SCAN_INTERVAL_MS = 140;
const MAX_DECODE_WIDTH = 640;
const SAME_CODE_IGNORE_MS = 6000;
const RESULT_MS = { success: 1800, repeat: 2400, error: 3200 } as const;

const COLORS = {
  page: EVENT_PASS_COLORS.page,
  card: EVENT_PASS_COLORS.card,
  green: EVENT_PASS_COLORS.primary,
  accent: EVENT_PASS_COLORS.accent,
  amber: EVENT_PASS_COLORS.warning,
  red: EVENT_PASS_COLORS.danger,
  muted: EVENT_PASS_COLORS.textMuted,
};

const FULL_HEIGHT = '100dvh';

export function HostessQrReaderClient({ brand, campaign, campaignTitle, scanner }: HostessQrReaderProps) {
  const title = campaignTitle || campaign;
  const targetLabel = columnLabel(scanner.targetColumn);
  const sessionKey = `hostess_auth_${brand}_${campaign}`;

  const [password, setPassword] = useState(scanner.accessCodeHint ?? '');
  const [checkingCode, setCheckingCode] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('off');
  const [startError, setStartError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastName, setLastName] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const pausedRef = useRef(false);
  const lastScanRef = useRef<{ data: string; at: number } | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const passwordRef = useRef(password);
  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

  const verifyCode = useCallback(
    async (code: string): Promise<{ ok: boolean; message?: string }> => {
      try {
        const res = await fetch(`/api/landing/${brand}/${campaign}/hostess-scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: code, verifyOnly: true }),
        });
        if (res.ok) return { ok: true };
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) return { ok: false, message: 'That access code is not right.' };
        return { ok: false, message: data?.error || 'The code could not be checked. Try again.' };
      } catch {
        return { ok: false, message: scanFailureMessage(0) };
      }
    },
    [brand, campaign]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = sessionStorage.getItem(sessionKey);
        if (!saved) return;
        const check = await verifyCode(saved);
        if (cancelled) return;
        if (check.ok) {
          setPassword(saved);
          setIsAuthenticated(true);
        } else {
          sessionStorage.removeItem(sessionKey);
        }
      } catch {
        // Private browsing can block storage; the unlock screen still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionKey, verifyCode]);

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    const code = password.trim();
    if (!code) {
      setLoginError('Enter the access code.');
      return;
    }
    setCheckingCode(true);
    const check = await verifyCode(code);
    setCheckingCode(false);
    if (!check.ok) {
      setLoginError(check.message ?? 'That access code is not right.');
      return;
    }
    setLoginError(null);
    setIsAuthenticated(true);
    try {
      sessionStorage.setItem(sessionKey, code);
    } catch {
      // Not saving the session is harmless.
    }
  }

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    releaseWakeLock();
    pausedRef.current = false;
    setCameraState('off');
    setProcessing(false);
    setResult(null);
    setTorchAvailable(false);
    setTorchOn(false);
  }, [releaseWakeLock]);

  const showResult = useCallback((next: ScanResult) => {
    setResult(next);
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(next.kind === 'success' ? [120] : next.kind === 'repeat' ? [60, 60, 60] : [260]);
    }
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => {
      resultTimerRef.current = null;
      setResult(null);
      pausedRef.current = false;
    }, RESULT_MS[next.kind]);
  }, []);

  function dismissResult() {
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
    setResult(null);
    pausedRef.current = false;
  }

  const submitScan = useCallback(
    async (rawQrData: string) => {
      setProcessing(true);
      try {
        const res = await fetch(`/api/landing/${brand}/${campaign}/hostess-scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: passwordRef.current, qrContent: rawQrData }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          try {
            sessionStorage.removeItem(sessionKey);
          } catch {
            // Nothing to clear.
          }
          stopCamera();
          setIsAuthenticated(false);
          setLoginError('The access code was not accepted. Enter it again to keep scanning.');
          return;
        }
        if (!res.ok) {
          showResult({ kind: 'error', message: scanFailureMessage(res.status, data?.error) });
          return;
        }
        const name: string = data.lead?.name || 'Attendee';
        setLastName(name);
        const column: string = data.movedTo || scanner.targetColumn;
        if (data.alreadyCheckedIn) {
          showResult({ kind: 'repeat', name, column });
        } else {
          setSessionCount((count) => count + 1);
          showResult({ kind: 'success', name, column });
        }
      } catch {
        showResult({ kind: 'error', message: scanFailureMessage(0) });
      } finally {
        setProcessing(false);
      }
    },
    [brand, campaign, scanner.targetColumn, sessionKey, showResult, stopCamera]
  );

  const handleDetected = useCallback(
    (data: string) => {
      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.data === data && now - last.at < SAME_CODE_IGNORE_MS) return;
      lastScanRef.current = { data, at: now };
      pausedRef.current = true;
      void submitScan(data);
    },
    [submitScan]
  );

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen');
    } catch {
      // Keeping the screen awake is a comfort, not a requirement.
    }
  }

  async function startCamera() {
    stopCamera();
    setStartError(null);
    setCameraState('starting');
    lastScanRef.current = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      setStartError('This browser cannot open the camera. Open the page in Safari or Chrome.');
      setCameraState('off');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      const capabilities = (stream.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
        torch?: boolean;
      };
      setTorchAvailable(Boolean(capabilities.torch));

      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      setCameraState('on');
      void requestWakeLock();

      const tick = (time: number) => {
        frameRef.current = requestAnimationFrame(tick);
        if (pausedRef.current || time - lastTickRef.current < SCAN_INTERVAL_MS) return;
        lastTickRef.current = time;
        const current = videoRef.current;
        const canvas = canvasRef.current;
        if (!current || !canvas || !current.videoWidth || current.readyState < current.HAVE_ENOUGH_DATA) return;
        const scale = Math.min(1, MAX_DECODE_WIDTH / current.videoWidth);
        const width = Math.round(current.videoWidth * scale);
        const height = Math.round(current.videoHeight * scale);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(current, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        const code = jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' });
        if (code?.data) handleDetected(code.data);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      stopCamera();
      setStartError(
        name === 'NotAllowedError'
          ? 'The camera is blocked. Allow camera access for this page in the browser settings, then try again.'
          : 'The camera could not start. Close other apps that use it, then try again.'
      );
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stopCamera();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopCamera();
    };
  }, [stopCamera]);

  const pageStyle: React.CSSProperties = {
    minHeight: FULL_HEIGHT,
    backgroundColor: COLORS.page,
    color: EVENT_PASS_COLORS.cssWhite,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 'calc(env(safe-area-inset-top) + 20px) 20px calc(env(safe-area-inset-bottom) + 20px)',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  };

  if (!isAuthenticated) {
    return (
      <Box component="main" style={{ ...pageStyle, justifyContent: 'center' }}>
        <Paper
          radius="xl"
          p="xl"
          style={{
            width: '100%',
            maxWidth: 400,
            backgroundColor: COLORS.card,
            border: `1px solid ${EVENT_PASS_COLORS.scannerBorder}`,
            boxShadow: `0 24px 60px ${EVENT_PASS_COLORS.scannerShadow}`,
          }}
        >
          <Stack gap="lg">
            <Stack gap={6} align="center">
              <Box
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 18,
                  background: EVENT_PASS_COLORS.scannerSuccessSurface,
                  border: `1px solid ${EVENT_PASS_COLORS.scannerSuccessBorder}`,
                  color: COLORS.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <IconLock size={32} />
              </Box>
              <Text component="h1" fw={800} size="xl" ta="center" m={0}>
                Check-in
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                {title}
              </Text>
            </Stack>

            <form onSubmit={handleLogin}>
              <Stack gap="md">
                <TextInput
                  label="Access code"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  placeholder="Enter the access code"
                  size="md"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  error={loginError}
                  styles={{
                    label: { color: EVENT_PASS_COLORS.scannerLabel, fontWeight: 700, marginBottom: 4 },
                    description: { color: COLORS.muted, marginBottom: 8 },
                    input: {
                      backgroundColor: EVENT_PASS_COLORS.scannerInput,
                      borderColor: EVENT_PASS_COLORS.scannerInputBorder,
                      color: EVENT_PASS_COLORS.cssWhite,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    },
                    error: { marginTop: 8 },
                  }}
                  description={
                    scanner.accessCodeHint ? (
                      <>
                        Code: <code style={{ color: COLORS.accent, fontWeight: 700 }}>{scanner.accessCodeHint}</code>
                      </>
                    ) : (
                      'Ask the event organiser for the code.'
                    )
                  }
                />
                <Button
                  type="submit"
                  size="lg"
                  radius="md"
                  fullWidth
                  loading={checkingCode}
                  style={{ backgroundColor: COLORS.green, fontWeight: 800 }}
                >
                  Unlock scanner
                </Button>
              </Stack>
            </form>
          </Stack>
        </Paper>
      </Box>
    );
  }

  const cameraOpen = cameraState !== 'off';

  return (
    <Box component="main" style={pageStyle}>
      <Stack gap={6} align="center" ta="center" mt="md" style={{ width: '100%', maxWidth: 420 }}>
        <Box
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px',
            borderRadius: 999,
            background: EVENT_PASS_COLORS.scannerSuccessSurface,
            border: `1px solid ${EVENT_PASS_COLORS.scannerSuccessBorder}`,
            color: COLORS.accent,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: 999, background: COLORS.accent }} />
          Check-in station
        </Box>
        <Text component="h1" fw={800} size="xl" m={0}>
          {title}
        </Text>
        <Text size="sm" c="dimmed">
          Scan an attendee&apos;s badge QR code to check them in.
        </Text>
      </Stack>

      <Stack gap="lg" align="stretch" justify="center" style={{ flex: 1, width: '100%', maxWidth: 420 }}>
        {startError && (
          <Paper
            p="md"
            radius="lg"
            role="alert"
            style={{ background: EVENT_PASS_COLORS.scannerErrorSurface, border: `1px solid ${EVENT_PASS_COLORS.scannerErrorBorder}` }}
          >
            <Box style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <IconAlertCircle size={20} color={EVENT_PASS_COLORS.errorText} style={{ flexShrink: 0, marginTop: 1 }} />
              <Text size="sm" c="red.2">
                {startError}
              </Text>
            </Box>
          </Paper>
        )}

        <Paper
          p="lg"
          radius="lg"
          style={{ backgroundColor: COLORS.card, border: `1px solid ${EVENT_PASS_COLORS.scannerCardBorder}`, textAlign: 'center' }}
        >
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em' }}>
            Checked in on this phone
          </Text>
          <Text fw={900} style={{ fontSize: 48, lineHeight: 1.1 }}>
            {sessionCount}
          </Text>
          <Text size="sm" c="dimmed" mih={20}>
            {lastName ? `Last: ${lastName}` : 'No one scanned yet'}
          </Text>
        </Paper>

        <Button
          type="button"
          onClick={startCamera}
          size="xl"
          radius="xl"
          fullWidth
          h={76}
          leftSection={<IconCamera size={30} />}
          style={{
            background: `linear-gradient(135deg, ${COLORS.green} 0%, ${EVENT_PASS_COLORS.success} 100%)`,
            fontSize: 20,
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            boxShadow: `0 12px 32px ${EVENT_PASS_COLORS.scannerButtonShadow}`,
          }}
        >
          {startError ? 'Try again' : 'Start scanning'}
        </Button>
        <Text size="xs" c="dimmed" ta="center">
          Each scan moves the attendee to {targetLabel}. The camera stays open for the next person.
        </Text>
      </Stack>

      {cameraOpen && (
        <Box
          role="dialog"
          aria-label="Badge scanner"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            height: FULL_HEIGHT,
            backgroundColor: EVENT_PASS_COLORS.cssBlack,
            overflow: 'hidden',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          <Box
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <Box
              style={{
                width: 'min(72vw, 320px)',
                aspectRatio: '1 / 1',
                borderRadius: 28,
                border: `3px solid ${COLORS.accent}`,
                boxShadow: `0 0 0 100vmax ${EVENT_PASS_COLORS.cameraMask}`,
              }}
            />
          </Box>

          <Box
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              padding: 'calc(env(safe-area-inset-top) + 14px) 16px 28px',
              background: `linear-gradient(to bottom, ${EVENT_PASS_COLORS.cameraGradient}, transparent)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Text fw={700} size="md" c="white">
              {cameraState === 'starting' ? 'Starting camera…' : 'Aim at the badge QR code'}
            </Text>
            <Box style={{ display: 'flex', gap: 10 }}>
              {torchAvailable && (
                <ActionIcon
                  size={48}
                  radius="xl"
                  variant="filled"
                  color={torchOn ? 'yellow' : 'dark'}
                  onClick={toggleTorch}
                  aria-label={torchOn ? 'Turn the light off' : 'Turn the light on'}
                  aria-pressed={torchOn}
                >
                  {torchOn ? <IconBolt size={24} /> : <IconBoltOff size={24} />}
                </ActionIcon>
              )}
              <ActionIcon
                size={48}
                radius="xl"
                variant="filled"
                color="dark"
                onClick={stopCamera}
                aria-label="Close the scanner"
              >
                <IconX size={24} />
              </ActionIcon>
            </Box>
          </Box>

          <Box
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '28px 16px calc(env(safe-area-inset-bottom) + 20px)',
              background: `linear-gradient(to top, ${EVENT_PASS_COLORS.cameraGradient}, transparent)`,
              textAlign: 'center',
            }}
          >
            <Text size="sm" c="gray.3">
              Hold the phone steady. {sessionCount > 0 ? `${sessionCount} checked in so far.` : ''}
            </Text>
          </Box>

          {processing && !result && (
            <Box
              role="status"
              style={{
                position: 'absolute',
                inset: 0,
                background: EVENT_PASS_COLORS.cameraControl,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
              }}
            >
              <IconRefresh size={48} color={COLORS.accent} style={{ animation: 'spin 1s linear infinite' }} />
              <Text fw={800} size="lg" c="white">
                Checking in…
              </Text>
              <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
            </Box>
          )}

          {result && (
            <Box
              role="status"
              aria-live="assertive"
              onClick={dismissResult}
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor:
                  result.kind === 'success' ? COLORS.green : result.kind === 'repeat' ? COLORS.amber : COLORS.red,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: 28,
                gap: 12,
              }}
            >
              <Box
                style={{
                  width: 112,
                  height: 112,
                  borderRadius: 999,
                  background: EVENT_PASS_COLORS.cssWhite,
                  color:
                    result.kind === 'success' ? COLORS.green : result.kind === 'repeat' ? COLORS.amber : COLORS.red,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                }}
              >
                {result.kind === 'success' && <IconCheck size={68} strokeWidth={3.5} />}
                {result.kind === 'repeat' && <IconUserCheck size={64} strokeWidth={2.5} />}
                {result.kind === 'error' && <IconAlertCircle size={68} strokeWidth={2.5} />}
              </Box>

              {result.kind === 'success' && (
                <>
                  <Text fw={900} c="white" tt="uppercase" style={{ fontSize: 36, letterSpacing: '0.04em' }}>
                    {scanner.successHeadline}
                  </Text>
                  <Text fw={700} size="xl" c="green.0">
                    {scanner.successMessage}
                  </Text>
                  <Text fw={600} c="white" style={{ background: EVENT_PASS_COLORS.resultLabel, padding: '8px 18px', borderRadius: 999 }}>
                    {result.name} · {columnLabel(result.column)}
                  </Text>
                </>
              )}
              {result.kind === 'repeat' && (
                <>
                  <Text fw={900} c="white" tt="uppercase" style={{ fontSize: 32, letterSpacing: '0.04em' }}>
                    already checked in
                  </Text>
                  <Text fw={600} c="white" style={{ background: EVENT_PASS_COLORS.resultLabel, padding: '8px 18px', borderRadius: 999 }}>
                    {result.name} · {columnLabel(result.column)}
                  </Text>
                </>
              )}
              {result.kind === 'error' && (
                <>
                  <Text fw={900} c="white" tt="uppercase" style={{ fontSize: 30, letterSpacing: '0.04em' }}>
                    not checked in
                  </Text>
                  <Text size="lg" c="white" maw={320}>
                    {result.message}
                  </Text>
                </>
              )}
              <Text size="xs" c="white" style={{ opacity: 0.75, marginTop: 8 }}>
                Tap to scan the next badge
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
