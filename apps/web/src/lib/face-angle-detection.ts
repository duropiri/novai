import * as faceapi from 'face-api.js';

// Face angle categories
export type FaceAngle =
  | 'front'
  | 'three_quarter_left'
  | 'three_quarter_right'
  | 'profile_left'
  | 'profile_right'
  | 'up'
  | 'down'
  | 'unknown';

export interface FaceAngleResult {
  angle: FaceAngle;
  confidence: number;
  yaw: number;   // left/right rotation (-90 to 90)
  pitch: number; // up/down rotation (-90 to 90)
}

export interface AngleCoverage {
  front: number;
  three_quarter_left: number;
  three_quarter_right: number;
  profile_left: number;
  profile_right: number;
  up: number;
  down: number;
  unknown: number;
  total: number;
}

export interface AngleCoverageAnalysis {
  coverage: AngleCoverage;
  recommendations: string[];
  score: number; // 0-100
}

// Model loading state
let modelsLoaded = false;
let modelsLoading: Promise<void> | null = null;

/**
 * Load face-api.js models (only needs to be called once)
 */
export async function loadFaceDetectionModels(): Promise<void> {
  if (modelsLoaded) return;

  if (modelsLoading) {
    await modelsLoading;
    return;
  }

  modelsLoading = (async () => {
    const MODEL_URL = '/models/face-api';

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    ]);

    modelsLoaded = true;
  })();

  await modelsLoading;
}

/**
 * Estimate head pose from facial landmarks
 * Uses the relative positions of key facial features to estimate yaw and pitch
 */
function estimateHeadPose(landmarks: faceapi.FaceLandmarks68): { yaw: number; pitch: number } {
  const positions = landmarks.positions;

  // Key landmark indices for 68-point model
  // Nose tip: 30
  // Left eye outer: 36, Left eye inner: 39
  // Right eye outer: 45, Right eye inner: 42
  // Left mouth corner: 48, Right mouth corner: 54
  // Chin: 8
  // Nose bridge top: 27

  const noseTip = positions[30];
  const leftEyeOuter = positions[36];
  const rightEyeOuter = positions[45];
  const leftMouthCorner = positions[48];
  const rightMouthCorner = positions[54];
  const chin = positions[8];
  const noseBridgeTop = positions[27];

  // Calculate yaw (left/right rotation) based on facial asymmetry
  const eyeWidth = rightEyeOuter.x - leftEyeOuter.x;
  const leftEyeToNose = noseTip.x - leftEyeOuter.x;
  const rightEyeToNose = rightEyeOuter.x - noseTip.x;

  // Ratio-based yaw estimation
  // If face is straight on, leftEyeToNose / rightEyeToNose ≈ 1
  // If turned left, ratio > 1; if turned right, ratio < 1
  const eyeNoseRatio = leftEyeToNose / rightEyeToNose;

  // Convert ratio to approximate angle (-90 to 90 degrees)
  // This is a simplified estimation
  let yaw = 0;
  if (eyeNoseRatio > 1) {
    yaw = Math.min(90, (eyeNoseRatio - 1) * 60); // Turned left (positive)
  } else {
    yaw = Math.max(-90, (eyeNoseRatio - 1) * 60); // Turned right (negative)
  }

  // Calculate pitch (up/down) based on nose-to-chin vs nose-to-eyes ratio
  const faceHeight = chin.y - noseBridgeTop.y;
  const upperFace = noseTip.y - noseBridgeTop.y;
  const lowerFace = chin.y - noseTip.y;

  // Normal ratio is about 1:1.5 (upper:lower from nose perspective)
  const pitchRatio = upperFace / lowerFace;
  const normalRatio = 0.67; // Approximate normal ratio

  // Convert to pitch angle
  let pitch = (pitchRatio - normalRatio) * 100;
  pitch = Math.max(-45, Math.min(45, pitch));

  return { yaw, pitch };
}

/**
 * Categorize head pose into angle category
 */
function categorizeAngle(yaw: number, pitch: number): FaceAngle {
  // Check pitch first (up/down takes precedence if significant)
  if (pitch > 20) return 'up';
  if (pitch < -20) return 'down';

  // Categorize by yaw (left/right)
  if (yaw > 50) return 'profile_left';
  if (yaw < -50) return 'profile_right';
  if (yaw > 20) return 'three_quarter_left';
  if (yaw < -20) return 'three_quarter_right';

  return 'front';
}

/**
 * Detect face angle from an image file
 */
export async function detectFaceAngle(imageFile: File): Promise<FaceAngleResult | null> {
  await loadFaceDetectionModels();

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      try {
        const detection = await faceapi
          .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks(true);

        if (!detection) {
          resolve(null);
          return;
        }

        const { yaw, pitch } = estimateHeadPose(detection.landmarks);
        const angle = categorizeAngle(yaw, pitch);

        resolve({
          angle,
          confidence: detection.detection.score,
          yaw,
          pitch,
        });
      } catch (error) {
        console.error('Face detection error:', error);
        resolve(null);
      }

      URL.revokeObjectURL(img.src);
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve(null);
    };

    img.src = URL.createObjectURL(imageFile);
  });
}

/**
 * Analyze angle coverage for a set of images
 */
export async function analyzeAngleCoverage(imageFiles: File[]): Promise<AngleCoverageAnalysis> {
  const coverage: AngleCoverage = {
    front: 0,
    three_quarter_left: 0,
    three_quarter_right: 0,
    profile_left: 0,
    profile_right: 0,
    up: 0,
    down: 0,
    unknown: 0,
    total: imageFiles.length,
  };

  // Process images in parallel (with concurrency limit)
  const BATCH_SIZE = 4;
  for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
    const batch = imageFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(detectFaceAngle));

    for (const result of results) {
      if (result) {
        coverage[result.angle]++;
      } else {
        coverage.unknown++;
      }
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (coverage.front < 2) {
    recommendations.push('Add more front-facing photos (looking directly at camera)');
  }
  if (coverage.three_quarter_left === 0 && coverage.three_quarter_right === 0) {
    recommendations.push('Add 3/4 angle shots (head turned slightly left or right)');
  } else if (coverage.three_quarter_left === 0) {
    recommendations.push('Add 3/4 left angle shots');
  } else if (coverage.three_quarter_right === 0) {
    recommendations.push('Add 3/4 right angle shots');
  }
  if (coverage.profile_left === 0 && coverage.profile_right === 0) {
    recommendations.push('Consider adding profile shots (side view)');
  }
  if (coverage.unknown > coverage.total * 0.3) {
    recommendations.push('Some images have unclear or no visible faces');
  }

  // Calculate coverage score (0-100)
  let score = 0;

  // Front is most important (up to 30 points)
  score += Math.min(30, coverage.front * 15);

  // 3/4 angles (up to 30 points)
  score += Math.min(15, coverage.three_quarter_left * 10);
  score += Math.min(15, coverage.three_quarter_right * 10);

  // Profiles (up to 20 points)
  score += Math.min(10, coverage.profile_left * 10);
  score += Math.min(10, coverage.profile_right * 10);

  // Variety bonus (up to 20 points)
  const angleTypes = [
    coverage.front > 0,
    coverage.three_quarter_left > 0,
    coverage.three_quarter_right > 0,
    coverage.profile_left > 0 || coverage.profile_right > 0,
  ].filter(Boolean).length;
  score += angleTypes * 5;

  return {
    coverage,
    recommendations,
    score: Math.min(100, score),
  };
}

/**
 * Get display name for angle category
 */
export function getAngleDisplayName(angle: FaceAngle): string {
  switch (angle) {
    case 'front': return 'Front';
    case 'three_quarter_left': return '3/4 Left';
    case 'three_quarter_right': return '3/4 Right';
    case 'profile_left': return 'Profile Left';
    case 'profile_right': return 'Profile Right';
    case 'up': return 'Looking Up';
    case 'down': return 'Looking Down';
    case 'unknown': return 'Unknown';
  }
}
