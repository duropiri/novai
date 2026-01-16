'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ANGLE_DISPLAY_NAMES, scanApi } from '@/lib/api';
import { useScanSocket } from '@/lib/scan-socket';
import {
  initializeFaceDetection,
  detectFace,
  classifyAngle,
  shouldAutoCapture,
  captureFrame,
  compressFrame,
  cleanupFaceDetection,
  type FaceDetectionResult,
  type AngleType,
} from '@/lib/face-detection';
import { FaceOverlay } from '@/components/scan/face-overlay';
import {
  Camera,
  Loader2,
  Check,
  WifiOff,
  RefreshCw,
  X,
} from 'lucide-react';

type AppState =
  | 'entering-code'
  | 'connecting'
  | 'initializing'
  | 'scanning'
  | 'completed'
  | 'error';

function MobilePageContent() {
  const searchParams = useSearchParams();
  const initialCode = searchParams.get('code') || '';

  // App state
  const [appState, setAppState] = useState<AppState>(
    initialCode ? 'connecting' : 'entering-code'
  );
  const [sessionCode, setSessionCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [targetAngles, setTargetAngles] = useState<string[]>([]);
  const [currentAngleIndex, setCurrentAngleIndex] = useState(0);
  const [capturedAngles, setCapturedAngles] = useState<Set<string>>(new Set());
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  // Face detection state
  const [detection, setDetection] = useState<FaceDetectionResult | null>(null);
  const [message, setMessage] = useState<string>('');
  const detectionLoopRef = useRef<number | null>(null);
  const lastCaptureTimeRef = useRef<number>(0);
  const frameCountRef = useRef(0);

  // Capture feedback
  const [showCaptureFlash, setShowCaptureFlash] = useState(false);
  const [lastCapturedAngle, setLastCapturedAngle] = useState<string | null>(null);

  // Socket connection
  const {
    connectionState,
    connect,
    disconnect,
    connectWithCode,
    sendFrame,
    sendCapture,
  } = useScanSocket({
    role: 'phone',
    events: {
      onGuideUpdate: ({ targetAngle }) => {
        const index = targetAngles.indexOf(targetAngle);
        if (index !== -1) {
          setCurrentAngleIndex(index);
        }
      },
      onSessionEnded: () => {
        setAppState('completed');
        stopCamera();
      },
      onCaptureConfirmed: ({ captureId, angle }) => {
        console.log('Capture confirmed:', captureId, angle);
        setCapturedAngles((prev) => new Set([...prev, angle]));
        setLastCapturedAngle(angle);

        // Move to next angle
        const nextIndex = currentAngleIndex + 1;
        if (nextIndex < targetAngles.length) {
          setCurrentAngleIndex(nextIndex);
        } else {
          // All angles captured
          setAppState('completed');
        }
      },
      onError: (errorMsg) => {
        setError(errorMsg);
        setAppState('error');
      },
    },
  });

  // Get current target angle
  const currentTargetAngle = targetAngles[currentAngleIndex] as AngleType | undefined;

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (err) {
      console.error('Camera error:', err);
      setError('Failed to access camera. Please allow camera permissions.');
      setAppState('error');
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  // Handle code submission
  const handleSubmitCode = async () => {
    if (!sessionCode || sessionCode.length < 6) {
      setError('Please enter a valid session code');
      return;
    }

    setAppState('connecting');
    setError(null);

    try {
      // Connect to WebSocket
      connect();

      // Wait for connection
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Connect with session code
      const result = await connectWithCode(sessionCode.toUpperCase());

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect');
      }

      setSessionId(result.sessionId!);
      setTargetAngles(result.targetAngles || []);
      setAutoCaptureEnabled(result.autoCaptureEnabled ?? true);
      setCapturedAngles(new Set(result.capturedAngles || []));

      // Initialize face detection
      setAppState('initializing');
      await initializeFaceDetection();

      // Start camera
      await startCamera();

      setAppState('scanning');
    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setAppState('error');
    }
  };

  // Detection loop
  useEffect(() => {
    if (appState !== 'scanning' || !cameraReady || !videoRef.current) {
      return;
    }

    let lastFrameTime = 0;
    const FRAME_INTERVAL = 100; // 10 FPS for detection
    const STREAM_INTERVAL = 66; // ~15 FPS for streaming

    const runDetection = (timestamp: number) => {
      if (!videoRef.current || appState !== 'scanning') return;

      // Run face detection
      const result = detectFace(videoRef.current, timestamp);
      setDetection(result);

      // Check for auto-capture
      if (
        autoCaptureEnabled &&
        currentTargetAngle &&
        result.detected &&
        result.eulerAngles
      ) {
        const captureCheck = shouldAutoCapture(
          result,
          currentTargetAngle,
          capturedAngles
        );

        setMessage(captureCheck.reason || '');

        // Auto-capture with debounce
        const now = Date.now();
        if (captureCheck.shouldCapture && now - lastCaptureTimeRef.current > 2000) {
          lastCaptureTimeRef.current = now;
          handleCapture();
        }
      }

      // Send preview frame periodically
      frameCountRef.current++;
      if (timestamp - lastFrameTime > STREAM_INTERVAL) {
        lastFrameTime = timestamp;
        sendPreviewFrame();
      }

      detectionLoopRef.current = requestAnimationFrame(runDetection);
    };

    detectionLoopRef.current = requestAnimationFrame(runDetection);

    return () => {
      if (detectionLoopRef.current) {
        cancelAnimationFrame(detectionLoopRef.current);
      }
    };
  }, [appState, cameraReady, currentTargetAngle, capturedAngles, autoCaptureEnabled]);

  // Send preview frame
  const sendPreviewFrame = async () => {
    if (!videoRef.current || connectionState !== 'connected') return;

    try {
      const frameData = await compressFrame(videoRef.current, 0.5);
      sendFrame(frameData);
    } catch (err) {
      console.error('Failed to send frame:', err);
    }
  };

  // Handle manual/auto capture
  const handleCapture = async () => {
    if (!videoRef.current || !currentTargetAngle) return;

    try {
      // Show flash feedback
      setShowCaptureFlash(true);
      setTimeout(() => setShowCaptureFlash(false), 200);

      // Capture high-quality frame
      const imageBase64 = captureFrame(videoRef.current, 0.9);

      // Send capture
      const result = await sendCapture({
        imageBase64,
        detectedAngle: currentTargetAngle,
        eulerAngles: detection?.eulerAngles || undefined,
        qualityScore: detection?.confidence || undefined,
        isAutoCaptured: autoCaptureEnabled,
      });

      if (!result.success) {
        console.error('Capture failed:', result.error);
      }
    } catch (err) {
      console.error('Capture error:', err);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      cleanupFaceDetection();
      disconnect();
    };
  }, []);

  // Auto-connect if code provided in URL
  useEffect(() => {
    if (initialCode && appState === 'connecting') {
      handleSubmitCode();
    }
  }, []);

  // Render based on app state
  if (appState === 'entering-code') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <Camera className="w-16 h-16 mb-6 text-white/80" />
        <h1 className="text-2xl font-bold mb-2">Face Scanner</h1>
        <p className="text-white/60 text-center mb-8">
          Enter the session code shown on your computer
        </p>

        <div className="w-full max-w-xs space-y-4">
          <Input
            type="text"
            value={sessionCode}
            onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
            placeholder="Enter code (e.g., ABC12345)"
            className="text-center text-xl font-mono tracking-widest bg-white/10 border-white/20 text-white placeholder:text-white/40"
            maxLength={8}
          />
          <Button
            onClick={handleSubmitCode}
            className="w-full"
            size="lg"
            disabled={!sessionCode || sessionCode.length < 6}
          >
            Connect
          </Button>
        </div>

        {error && (
          <p className="text-red-400 text-sm mt-4 text-center">{error}</p>
        )}
      </div>
    );
  }

  if (appState === 'connecting' || appState === 'initializing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <Loader2 className="w-12 h-12 animate-spin mb-4" />
        <p className="text-white/80">
          {appState === 'connecting'
            ? 'Connecting to session...'
            : 'Initializing camera...'}
        </p>
      </div>
    );
  }

  if (appState === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <WifiOff className="w-16 h-16 mb-6 text-red-400" />
        <h1 className="text-xl font-bold mb-2">Connection Error</h1>
        <p className="text-white/60 text-center mb-6">{error}</p>
        <Button
          onClick={() => {
            setAppState('entering-code');
            setError(null);
          }}
          variant="outline"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  if (appState === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6">
        <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mb-6">
          <Check className="w-10 h-10" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Scan Complete!</h1>
        <p className="text-white/60 text-center mb-2">
          {capturedAngles.size} angles captured successfully
        </p>
        <p className="text-white/40 text-sm text-center mb-8">
          You can close this page now
        </p>
        <Button
          onClick={() => {
            setAppState('entering-code');
            setSessionCode('');
            setCapturedAngles(new Set());
          }}
          variant="outline"
        >
          Start New Session
        </Button>
      </div>
    );
  }

  // Scanning state
  return (
    <div className="relative h-screen overflow-hidden">
      {/* Camera feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
        style={{ transform: 'scaleX(-1)' }} // Mirror for selfie view
      />

      {/* Face overlay */}
      {currentTargetAngle && (
        <FaceOverlay
          detection={detection}
          targetAngle={currentTargetAngle}
          message={message}
        />
      )}

      {/* Capture flash */}
      {showCaptureFlash && (
        <div className="absolute inset-0 bg-white/50 animate-pulse" />
      )}

      {/* Progress bar */}
      <div className="absolute top-0 left-0 right-0 safe-area-inset-top">
        <div className="h-1 bg-white/20">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{
              width: `${(capturedAngles.size / targetAngles.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Captured angles indicators */}
      <div className="absolute top-4 left-4 right-4 flex justify-center gap-2 safe-area-inset-top">
        {targetAngles.map((angle, index) => {
          const isCaptured = capturedAngles.has(angle);
          const isCurrent = index === currentAngleIndex;

          return (
            <div
              key={angle}
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-xs',
                'transition-all duration-200',
                isCaptured && 'bg-green-500',
                isCurrent && !isCaptured && 'bg-white/30 ring-2 ring-white',
                !isCaptured && !isCurrent && 'bg-white/10'
              )}
            >
              {isCaptured ? (
                <Check className="w-4 h-4" />
              ) : (
                <span className="font-medium">{index + 1}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Last captured feedback */}
      {lastCapturedAngle && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 safe-area-inset-top">
          <div className="px-4 py-2 bg-green-500/90 rounded-full text-sm font-medium animate-bounce">
            <Check className="w-4 h-4 inline-block mr-1" />
            {ANGLE_DISPLAY_NAMES[lastCapturedAngle]} captured!
          </div>
        </div>
      )}

      {/* Manual capture button */}
      <div className="absolute bottom-8 left-0 right-0 flex justify-center safe-area-inset-bottom">
        <Button
          onClick={handleCapture}
          size="lg"
          className="w-20 h-20 rounded-full bg-white/90 hover:bg-white text-black"
          disabled={!currentTargetAngle || capturedAngles.has(currentTargetAngle)}
        >
          <Camera className="w-8 h-8" />
        </Button>
      </div>

      {/* Cancel button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 text-white/80 safe-area-inset-top"
        onClick={() => {
          stopCamera();
          disconnect();
          setAppState('entering-code');
        }}
      >
        <X className="w-6 h-6" />
      </Button>
    </div>
  );
}

export default function MobilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      }
    >
      <MobilePageContent />
    </Suspense>
  );
}
