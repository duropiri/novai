'use client';

import { cn } from '@/lib/utils';
import { ANGLE_DISPLAY_NAMES } from '@/lib/api';
import type { AngleType, FaceDetectionResult } from '@/lib/face-detection';

interface FaceOverlayProps {
  detection: FaceDetectionResult | null;
  targetAngle: AngleType;
  message?: string;
  className?: string;
}

// Guide overlay SVGs for each angle
const ANGLE_GUIDES: Record<AngleType, React.ReactNode> = {
  front: (
    <ellipse
      cx="50%"
      cy="45%"
      rx="25%"
      ry="35%"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeDasharray="8 4"
    />
  ),
  profile_left: (
    <g transform="translate(35%, 45%)">
      <ellipse
        cx="0"
        cy="0"
        rx="20%"
        ry="32%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="8 4"
        transform="rotate(-15)"
      />
      <path
        d="M -18% 0 L -25% 0"
        stroke="currentColor"
        strokeWidth="2"
        markerEnd="url(#arrow)"
      />
    </g>
  ),
  profile_right: (
    <g transform="translate(65%, 45%)">
      <ellipse
        cx="0"
        cy="0"
        rx="20%"
        ry="32%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="8 4"
        transform="rotate(15)"
      />
      <path
        d="M 18% 0 L 25% 0"
        stroke="currentColor"
        strokeWidth="2"
        markerEnd="url(#arrow)"
      />
    </g>
  ),
  quarter_left: (
    <g transform="translate(42%, 45%)">
      <ellipse
        cx="0"
        cy="0"
        rx="23%"
        ry="33%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="8 4"
        transform="rotate(-8)"
      />
    </g>
  ),
  quarter_right: (
    <g transform="translate(58%, 45%)">
      <ellipse
        cx="0"
        cy="0"
        rx="23%"
        ry="33%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="8 4"
        transform="rotate(8)"
      />
    </g>
  ),
  up: (
    <g transform="translate(50%, 50%)">
      <ellipse
        cx="0"
        cy="0"
        rx="25%"
        ry="30%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="8 4"
      />
      <path
        d="M 0 -25% L 0 -32%"
        stroke="currentColor"
        strokeWidth="2"
        markerEnd="url(#arrow)"
      />
    </g>
  ),
  down: (
    <g transform="translate(50%, 40%)">
      <ellipse
        cx="0"
        cy="0"
        rx="25%"
        ry="30%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="8 4"
      />
      <path
        d="M 0 25% L 0 32%"
        stroke="currentColor"
        strokeWidth="2"
        markerEnd="url(#arrow)"
      />
    </g>
  ),
  smile: (
    <g transform="translate(50%, 45%)">
      <ellipse
        cx="0"
        cy="0"
        rx="25%"
        ry="35%"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="8 4"
      />
      <path
        d="M -10% 10% Q 0 18% 10% 10%"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
    </g>
  ),
};

export function FaceOverlay({
  detection,
  targetAngle,
  message,
  className,
}: FaceOverlayProps) {
  const isAligned = detection?.detected && !message?.includes('Turn');

  return (
    <div className={cn('absolute inset-0 pointer-events-none', className)}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full"
      >
        {/* Arrow marker definition */}
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="5"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {/* Guide overlay */}
        <g
          className={cn(
            'transition-colors duration-300',
            isAligned ? 'text-green-500' : 'text-white/70'
          )}
        >
          {ANGLE_GUIDES[targetAngle]}
        </g>

        {/* Face bounding box when detected */}
        {detection?.detected && detection.boundingBox && (
          <rect
            x={`${detection.boundingBox.x * 100}%`}
            y={`${detection.boundingBox.y * 100}%`}
            width={`${detection.boundingBox.w * 100}%`}
            height={`${detection.boundingBox.h * 100}%`}
            fill="none"
            stroke={isAligned ? '#22c55e' : '#f59e0b'}
            strokeWidth="0.5"
            rx="2"
          />
        )}
      </svg>

      {/* Target angle label */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div
          className={cn(
            'px-4 py-2 rounded-full text-sm font-medium',
            'backdrop-blur-sm',
            isAligned
              ? 'bg-green-500/90 text-white'
              : 'bg-black/60 text-white'
          )}
        >
          {ANGLE_DISPLAY_NAMES[targetAngle] || targetAngle}
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2">
          <div className="px-4 py-2 rounded-lg bg-black/70 text-white text-sm max-w-[80%] text-center">
            {message}
          </div>
        </div>
      )}

      {/* Capture ready indicator */}
      {isAligned && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <div className="px-6 py-3 rounded-full bg-green-500 text-white font-medium animate-pulse">
            Capturing...
          </div>
        </div>
      )}
    </div>
  );
}
