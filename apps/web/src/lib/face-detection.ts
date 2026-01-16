'use client';

import {
  FaceLandmarker,
  FilesetResolver,
  FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

export interface EulerAngles {
  pitch: number; // Up/down rotation
  yaw: number; // Left/right rotation
  roll: number; // Tilt
}

export interface FaceDetectionResult {
  detected: boolean;
  landmarks: number[][] | null;
  boundingBox: { x: number; y: number; w: number; h: number } | null;
  eulerAngles: EulerAngles | null;
  confidence: number;
}

export type AngleType =
  | 'front'
  | 'profile_left'
  | 'profile_right'
  | 'quarter_left'
  | 'quarter_right'
  | 'up'
  | 'down'
  | 'smile';

// Euler angle thresholds for angle classification
const ANGLE_THRESHOLDS = {
  profile: 50, // Yaw threshold for full profile
  quarter: 20, // Yaw threshold for 3/4 view
  tilt: 15, // Pitch threshold for up/down
};

let faceLandmarker: FaceLandmarker | null = null;
let isInitializing = false;
let initPromise: Promise<FaceLandmarker> | null = null;

/**
 * Initialize the face landmarker
 */
export async function initializeFaceDetection(): Promise<FaceLandmarker> {
  if (faceLandmarker) {
    return faceLandmarker;
  }

  if (initPromise) {
    return initPromise;
  }

  if (isInitializing) {
    // Wait for existing initialization
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (faceLandmarker) {
          clearInterval(checkInterval);
          resolve(faceLandmarker);
        }
      }, 100);
    });
  }

  isInitializing = true;

  initPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });

      return faceLandmarker;
    } catch (error) {
      console.error('Failed to initialize face detection:', error);
      isInitializing = false;
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Calculate euler angles from facial transformation matrix
 */
function calculateEulerAngles(matrix: number[]): EulerAngles {
  // Extract rotation from 4x4 transformation matrix
  // Matrix is column-major: [m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33]
  const m00 = matrix[0];
  const m10 = matrix[1];
  const m20 = matrix[2];
  const m01 = matrix[4];
  const m11 = matrix[5];
  const m21 = matrix[6];
  const m02 = matrix[8];
  const m12 = matrix[9];
  const m22 = matrix[10];

  // Calculate euler angles from rotation matrix
  const sy = Math.sqrt(m00 * m00 + m10 * m10);
  const singular = sy < 1e-6;

  let pitch: number, yaw: number, roll: number;

  if (!singular) {
    pitch = Math.atan2(-m20, sy);
    yaw = Math.atan2(m10, m00);
    roll = Math.atan2(m21, m22);
  } else {
    pitch = Math.atan2(-m20, sy);
    yaw = Math.atan2(-m01, m11);
    roll = 0;
  }

  // Convert to degrees
  return {
    pitch: pitch * (180 / Math.PI),
    yaw: yaw * (180 / Math.PI),
    roll: roll * (180 / Math.PI),
  };
}

/**
 * Calculate bounding box from landmarks
 */
function calculateBoundingBox(
  landmarks: { x: number; y: number; z: number }[]
): { x: number; y: number; w: number; h: number } {
  let minX = 1,
    maxX = 0,
    minY = 1,
    maxY = 0;

  for (const landmark of landmarks) {
    minX = Math.min(minX, landmark.x);
    maxX = Math.max(maxX, landmark.x);
    minY = Math.min(minY, landmark.y);
    maxY = Math.max(maxY, landmark.y);
  }

  // Add padding (10%)
  const padding = 0.1;
  const w = maxX - minX;
  const h = maxY - minY;

  return {
    x: Math.max(0, minX - w * padding),
    y: Math.max(0, minY - h * padding),
    w: Math.min(1 - (minX - w * padding), w * (1 + 2 * padding)),
    h: Math.min(1 - (minY - h * padding), h * (1 + 2 * padding)),
  };
}

/**
 * Detect face in a video frame
 */
export function detectFace(
  video: HTMLVideoElement,
  timestamp: number
): FaceDetectionResult {
  if (!faceLandmarker) {
    return {
      detected: false,
      landmarks: null,
      boundingBox: null,
      eulerAngles: null,
      confidence: 0,
    };
  }

  try {
    const result: FaceLandmarkerResult = faceLandmarker.detectForVideo(video, timestamp);

    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      return {
        detected: false,
        landmarks: null,
        boundingBox: null,
        eulerAngles: null,
        confidence: 0,
      };
    }

    const landmarks = result.faceLandmarks[0];
    const transformMatrix = result.facialTransformationMatrixes?.[0];

    // Convert landmarks to 2D array
    const landmarkArray = landmarks.map((l) => [l.x, l.y, l.z]);

    // Calculate bounding box
    const boundingBox = calculateBoundingBox(landmarks);

    // Calculate euler angles from transformation matrix
    let eulerAngles: EulerAngles | null = null;
    if (transformMatrix?.data) {
      eulerAngles = calculateEulerAngles(Array.from(transformMatrix.data));
    }

    // Calculate confidence from face blendshapes if available
    let confidence = 0.9; // Default high confidence if face is detected
    if (result.faceBlendshapes?.[0]?.categories) {
      // Use the neutral category as an indicator of face quality
      const neutralCategory = result.faceBlendshapes[0].categories.find(
        (c) => c.categoryName === '_neutral'
      );
      if (neutralCategory) {
        confidence = neutralCategory.score;
      }
    }

    return {
      detected: true,
      landmarks: landmarkArray,
      boundingBox,
      eulerAngles,
      confidence,
    };
  } catch (error) {
    console.error('Face detection error:', error);
    return {
      detected: false,
      landmarks: null,
      boundingBox: null,
      eulerAngles: null,
      confidence: 0,
    };
  }
}

/**
 * Classify the detected angle based on euler angles
 */
export function classifyAngle(eulerAngles: EulerAngles): AngleType {
  const { pitch, yaw } = eulerAngles;

  // Check profiles first (strongest signal)
  if (yaw < -ANGLE_THRESHOLDS.profile) {
    return 'profile_left';
  }
  if (yaw > ANGLE_THRESHOLDS.profile) {
    return 'profile_right';
  }

  // Check quarter views
  if (yaw < -ANGLE_THRESHOLDS.quarter) {
    return 'quarter_left';
  }
  if (yaw > ANGLE_THRESHOLDS.quarter) {
    return 'quarter_right';
  }

  // Check up/down
  if (pitch > ANGLE_THRESHOLDS.tilt) {
    return 'up';
  }
  if (pitch < -ANGLE_THRESHOLDS.tilt) {
    return 'down';
  }

  // Default to front
  return 'front';
}

/**
 * Check if a smile is detected
 */
export function detectSmile(result: FaceLandmarkerResult): boolean {
  if (!result.faceBlendshapes?.[0]?.categories) {
    return false;
  }

  // Check for smile blendshapes
  const mouthSmileLeft = result.faceBlendshapes[0].categories.find(
    (c) => c.categoryName === 'mouthSmileLeft'
  );
  const mouthSmileRight = result.faceBlendshapes[0].categories.find(
    (c) => c.categoryName === 'mouthSmileRight'
  );

  const smileThreshold = 0.4;
  const leftSmile = mouthSmileLeft?.score ?? 0;
  const rightSmile = mouthSmileRight?.score ?? 0;

  return leftSmile > smileThreshold || rightSmile > smileThreshold;
}

/**
 * Determine if auto-capture should trigger
 */
export interface AutoCaptureCheck {
  shouldCapture: boolean;
  reason?: string;
  detectedAngle: AngleType;
  qualityScore: number;
}

export function shouldAutoCapture(
  detection: FaceDetectionResult,
  targetAngle: AngleType,
  capturedAngles: Set<string>,
  options: {
    minFaceSize?: number; // Minimum face area as fraction of frame (0-1)
    maxCenterOffset?: number; // Max distance from center (0-1)
    minConfidence?: number; // Minimum detection confidence
  } = {}
): AutoCaptureCheck {
  const {
    minFaceSize = 0.15,
    maxCenterOffset = 0.2,
    minConfidence = 0.7,
  } = options;

  // Face must be detected
  if (!detection.detected || !detection.eulerAngles || !detection.boundingBox) {
    return {
      shouldCapture: false,
      reason: 'No face detected',
      detectedAngle: 'front',
      qualityScore: 0,
    };
  }

  // Check confidence
  if (detection.confidence < minConfidence) {
    return {
      shouldCapture: false,
      reason: 'Low detection confidence',
      detectedAngle: classifyAngle(detection.eulerAngles),
      qualityScore: detection.confidence,
    };
  }

  // Face must be large enough
  const faceArea = detection.boundingBox.w * detection.boundingBox.h;
  if (faceArea < minFaceSize) {
    return {
      shouldCapture: false,
      reason: 'Face too small - move closer',
      detectedAngle: classifyAngle(detection.eulerAngles),
      qualityScore: faceArea / minFaceSize,
    };
  }

  // Face must be centered
  const centerX = detection.boundingBox.x + detection.boundingBox.w / 2;
  const centerY = detection.boundingBox.y + detection.boundingBox.h / 2;
  const offsetX = Math.abs(centerX - 0.5);
  const offsetY = Math.abs(centerY - 0.5);

  if (offsetX > maxCenterOffset || offsetY > maxCenterOffset) {
    return {
      shouldCapture: false,
      reason: 'Center your face in the frame',
      detectedAngle: classifyAngle(detection.eulerAngles),
      qualityScore: 1 - Math.max(offsetX, offsetY),
    };
  }

  // Classify the detected angle
  const detectedAngle = classifyAngle(detection.eulerAngles);

  // Check if this angle matches the target
  if (detectedAngle !== targetAngle) {
    return {
      shouldCapture: false,
      reason: `Turn to ${targetAngle} position`,
      detectedAngle,
      qualityScore: detection.confidence,
    };
  }

  // Check if angle already captured
  if (capturedAngles.has(targetAngle)) {
    return {
      shouldCapture: false,
      reason: 'Angle already captured',
      detectedAngle,
      qualityScore: detection.confidence,
    };
  }

  // Calculate quality score
  const centeringScore = 1 - Math.max(offsetX, offsetY) / maxCenterOffset;
  const sizeScore = Math.min(1, faceArea / (minFaceSize * 2));
  const qualityScore = (detection.confidence + centeringScore + sizeScore) / 3;

  return {
    shouldCapture: true,
    detectedAngle,
    qualityScore,
  };
}

/**
 * Convert video frame to base64 JPEG
 */
export function captureFrame(video: HTMLVideoElement, quality = 0.85): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);

  // Return base64 without the data URL prefix
  return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
}

/**
 * Compress video frame to ArrayBuffer for streaming
 */
export function compressFrame(video: HTMLVideoElement, quality = 0.5): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    // Use lower resolution for streaming preview
    const scale = 0.5;
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to compress frame'));
          return;
        }
        blob.arrayBuffer().then(resolve).catch(reject);
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Cleanup face detection resources
 */
export function cleanupFaceDetection(): void {
  if (faceLandmarker) {
    faceLandmarker.close();
    faceLandmarker = null;
  }
  isInitializing = false;
  initPromise = null;
}
