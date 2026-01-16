'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { scanApi } from '@/lib/api';
import { useScanSocket } from '@/lib/scan-socket';
import {
  initializeFaceDetection,
  cleanupFaceDetection,
} from '@/lib/face-detection';
import { Loader2, Check, WifiOff, RefreshCw } from 'lucide-react';

type AppState =
  | 'entering-code'
  | 'connecting'
  | 'ready'
  | 'recording'
  | 'processing'
  | 'completed'
  | 'error';

// Generate random 2-digit numbers for verification
function generateVerificationNumbers(): string[] {
  return Array.from({ length: 3 }, () =>
    String(Math.floor(Math.random() * 90) + 10)
  );
}

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
  const [verificationNumbers] = useState<string[]>(generateVerificationNumbers);

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  // Recording state
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [currentInstruction, setCurrentInstruction] = useState('');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepProgress, setStepProgress] = useState(0);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Frame streaming
  const detectionLoopRef = useRef<number | null>(null);

  // Socket connection
  const {
    connectionState,
    connect,
    disconnect,
    connectWithCode,
    sendFrame,
  } = useScanSocket({
    role: 'phone',
    events: {
      onSessionEnded: () => {
        setAppState('completed');
        stopCamera();
      },
      onError: (errorMsg) => {
        setError(errorMsg);
        setAppState('error');
      },
    },
  });

  // Check if we're in a secure context (HTTPS or localhost)
  const isSecureContext =
    typeof window !== 'undefined' &&
    (window.isSecureContext ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1');

  // Start camera
  const startCamera = async () => {
    if (!isSecureContext) {
      setError(
        'Camera requires HTTPS. Please access this page via HTTPS.'
      );
      setAppState('error');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera not supported on this device or browser.');
      setAppState('error');
      return;
    }

    if (!videoRef.current) {
      console.error('Video element not ready');
      return;
    }

    try {
      console.log('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });

      console.log('Camera access granted');
      streamRef.current = stream;

      const video = videoRef.current;
      video.srcObject = stream;

      // Wait for video to be ready
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
        } else {
          video.onloadeddata = () => resolve();
        }
      });

      await video.play();
      console.log('Camera playing:', video.videoWidth, 'x', video.videoHeight);
      setCameraReady(true);
    } catch (err) {
      console.error('Camera error:', err);
      setError('Failed to access camera. Please allow camera and microphone permissions.');
      setAppState('error');
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (detectionLoopRef.current) {
      cancelAnimationFrame(detectionLoopRef.current);
      detectionLoopRef.current = null;
    }
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
      // Wait for socket to actually connect
      const connected = await connect();
      if (!connected) {
        throw new Error('Failed to connect to server');
      }

      console.log('Socket connected, joining session...');
      const result = await connectWithCode(sessionCode.toUpperCase());
      console.log('connectWithCode result:', result);

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect');
      }

      setSessionId(result.sessionId!);
      console.log('Initializing face detection...');
      await initializeFaceDetection();
      console.log('Setting state to ready');
      setAppState('ready');
    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setAppState('error');
    }
  };

  // Start camera when video element is available and state is ready
  useEffect(() => {
    if (appState === 'ready' && videoRef.current && !cameraReady) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        startCamera();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [appState, cameraReady]);

  // Recording instructions sequence
  const instructions = [
    'Say the numbers on screen',
    'Look straight ahead',
    'Slowly turn left',
    'Slowly turn right',
    'Tilt your head up slightly',
    'Tilt your head down slightly',
    'Smile naturally',
  ];

  // Start recording
  const handleStartRecording = () => {
    if (!streamRef.current) return;

    recordedChunksRef.current = [];
    setRecordingProgress(0);
    setCurrentStepIndex(0);
    setStepProgress(0);
    setCurrentInstruction(instructions[0]);
    setAppState('recording');

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: 'video/webm;codecs=vp9',
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      handleRecordingComplete();
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);

    // Step durations: 8s for numbers, 3s for each pose
    const stepDurations = [8000, 3000, 3000, 3000, 3000, 3000, 3000];
    const totalDuration = stepDurations.reduce((a, b) => a + b, 0);
    let elapsed = 0;

    recordingTimerRef.current = setInterval(() => {
      elapsed += 100;
      setRecordingProgress((elapsed / totalDuration) * 100);

      // Find current step based on cumulative durations
      let cumulativeTime = 0;
      let instructionIndex = 0;
      for (let i = 0; i < stepDurations.length; i++) {
        if (elapsed < cumulativeTime + stepDurations[i]) {
          instructionIndex = i;
          break;
        }
        cumulativeTime += stepDurations[i];
        if (i === stepDurations.length - 1) {
          instructionIndex = i;
        }
      }

      // Calculate progress within current step (0-100%)
      const elapsedInStep = elapsed - cumulativeTime;
      const currentStepDuration = stepDurations[instructionIndex];
      const stepProgressPercent = Math.min((elapsedInStep / currentStepDuration) * 100, 100);

      setCurrentStepIndex(instructionIndex);
      setStepProgress(stepProgressPercent);
      setCurrentInstruction(instructions[instructionIndex]);

      if (elapsed >= totalDuration) {
        clearInterval(recordingTimerRef.current!);
        mediaRecorder.stop();
      }
    }, 100);
  };

  // Handle recording complete
  const handleRecordingComplete = async () => {
    setAppState('processing');

    try {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });

      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];

        if (sessionId) {
          await scanApi.uploadScanVideo(sessionId, base64, verificationNumbers);
        }

        setAppState('completed');
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('Upload error:', err);
      setError('Failed to upload recording. Please try again.');
      setAppState('error');
    }
  };

  // Stream preview frames to desktop
  const streamCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    if (
      (appState !== 'ready' && appState !== 'recording') ||
      !cameraReady ||
      !videoRef.current ||
      connectionState !== 'connected'
    ) {
      return;
    }

    console.log('Starting frame streaming at 30fps...');
    let lastFrameTime = 0;
    const STREAM_INTERVAL = 33; // ~30fps

    // Create reusable canvas for better performance
    if (!streamCanvasRef.current) {
      streamCanvasRef.current = document.createElement('canvas');
    }
    const canvas = streamCanvasRef.current;
    const video = videoRef.current;

    // Set canvas size once
    const scale = 0.5;
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    if (!streamCtxRef.current) {
      streamCtxRef.current = canvas.getContext('2d', { alpha: false });
    }
    const ctx = streamCtxRef.current;

    const streamFrames = (timestamp: number) => {
      if (
        !videoRef.current ||
        (appState !== 'ready' && appState !== 'recording') ||
        connectionState !== 'connected'
      ) {
        return;
      }

      if (timestamp - lastFrameTime > STREAM_INTERVAL) {
        lastFrameTime = timestamp;

        if (video.videoWidth > 0 && video.videoHeight > 0 && ctx) {
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            canvas.toBlob(
              (blob) => {
                if (blob) {
                  blob.arrayBuffer().then((buffer) => {
                    sendFrame(buffer);
                  });
                }
              },
              'image/jpeg',
              0.6
            );
          } catch (err) {
            // Ignore errors
          }
        }
      }

      detectionLoopRef.current = requestAnimationFrame(streamFrames);
    };

    detectionLoopRef.current = requestAnimationFrame(streamFrames);

    return () => {
      if (detectionLoopRef.current) {
        cancelAnimationFrame(detectionLoopRef.current);
      }
    };
  }, [appState, cameraReady, connectionState, sendFrame]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      cleanupFaceDetection();
      disconnect();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [disconnect]);

  // Auto-connect if code provided in URL
  useEffect(() => {
    if (initialCode && appState === 'connecting') {
      handleSubmitCode();
    }
  }, []);

  // Determine if camera view should be shown
  const showCamera = appState === 'ready' || appState === 'recording';

  return (
    <div className="relative h-[100dvh] overflow-hidden bg-black text-white">
      {/* Video element - always rendered but only visible when needed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
          showCamera ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        style={{ transform: 'scaleX(-1)' }}
      />

      {/* Content overlay */}
      <div className="absolute inset-0 flex flex-col">
        {/* Entering Code */}
        {appState === 'entering-code' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <h1 className="text-2xl font-bold mb-2">Face Scan</h1>
            <p className="text-white/60 text-center mb-8">
              Enter the session code shown on your computer
            </p>

            <div className="w-full max-w-xs space-y-4">
              <Input
                type="text"
                value={sessionCode}
                onChange={(e) => setSessionCode(e.target.value.toUpperCase())}
                placeholder="Enter code"
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
        )}

        {/* Connecting */}
        {appState === 'connecting' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <Loader2 className="w-12 h-12 animate-spin mb-4" />
            <p className="text-white/80">Connecting...</p>
          </div>
        )}

        {/* Error */}
        {appState === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6">
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
        )}

        {/* Completed */}
        {appState === 'completed' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mb-6">
              <Check className="w-10 h-10" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Scan Complete!</h1>
            <p className="text-white/60 text-center mb-2">
              Your face scan has been uploaded
            </p>
            <p className="text-white/40 text-sm text-center">
              You can close this page now
            </p>
          </div>
        )}

        {/* Processing */}
        {appState === 'processing' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <Loader2 className="w-12 h-12 animate-spin mb-4" />
            <p className="text-white/80">Processing your scan...</p>
          </div>
        )}

        {/* Ready / Recording - Camera overlay */}
        {showCamera && (
          <>
            {/* Loading indicator while camera initializes */}
            {!cameraReady && (
              <div className="flex-1 flex flex-col items-center justify-center">
                <Loader2 className="w-12 h-12 animate-spin mb-4" />
                <p className="text-white/80">Starting camera...</p>
              </div>
            )}

            {/* Camera ready - show instructions */}
            {cameraReady && (
              <>
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center">
                    {appState === 'ready' ? (
                      <>
                        <p className="text-xl font-medium text-white mb-4 drop-shadow-lg">
                          Start recording and say the numbers on the screen
                        </p>
                        <p className="text-sm text-white/80 drop-shadow">
                          You'll be guided through different poses
                        </p>
                      </>
                    ) : (
                      <>
                        {/* Step indicator */}
                        <p className="text-sm text-white/60 mb-2 drop-shadow">
                          Step {currentStepIndex + 1} of {instructions.length}
                        </p>

                        {/* Current instruction */}
                        {currentStepIndex === 0 ? (
                          <div className="text-center">
                            <p className="text-xl font-medium text-white mb-6 drop-shadow-lg">
                              Say the numbers below
                            </p>
                            <div className="flex justify-center gap-6">
                              {verificationNumbers.map((num, i) => (
                                <span
                                  key={i}
                                  className="text-5xl font-bold text-white drop-shadow-lg"
                                >
                                  {num}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <p className="text-2xl font-medium text-white drop-shadow-lg">
                            {currentInstruction}
                          </p>
                        )}

                        {/* Segmented progress bar */}
                        <div className="mt-8 w-72 mx-auto">
                          <div className="flex gap-1">
                            {instructions.map((_, index) => (
                              <div
                                key={index}
                                className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden"
                              >
                                <div
                                  className="h-full bg-white transition-all duration-100 ease-linear"
                                  style={{
                                    width: index < currentStepIndex
                                      ? '100%'
                                      : index === currentStepIndex
                                        ? `${stepProgress}%`
                                        : '0%'
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                          {/* Time remaining for current step */}
                          <p className="text-xs text-white/50 mt-2 text-center">
                            {Math.ceil((100 - stepProgress) / 100 * (currentStepIndex === 0 ? 8 : 3))}s remaining
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="p-6 pb-8">
                  {appState === 'ready' ? (
                    <Button
                      onClick={handleStartRecording}
                      size="lg"
                      className="w-full bg-white text-black hover:bg-white/90 font-semibold text-lg py-6"
                    >
                      Start Recording
                    </Button>
                  ) : (
                    <div className="flex items-center justify-center">
                      <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse mr-2" />
                      <span className="text-white font-medium">Recording...</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function MobilePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[100dvh] bg-black">
          <Loader2 className="w-8 h-8 animate-spin text-white" />
        </div>
      }
    >
      <MobilePageContent />
    </Suspense>
  );
}
