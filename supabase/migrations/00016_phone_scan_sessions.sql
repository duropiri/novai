-- Phone Camera Scan Sessions
-- Tracks phone-to-desktop pairing for live camera scanning

CREATE TABLE phone_scan_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pairing
  session_code VARCHAR(8) UNIQUE NOT NULL,  -- Short code for QR/manual entry
  session_secret VARCHAR(64) NOT NULL,       -- Secret for WebSocket auth
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'scanning', 'completed', 'expired')),

  -- Connection tracking
  desktop_connected_at TIMESTAMPTZ,
  phone_connected_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,

  -- Scan configuration
  target_angles JSONB DEFAULT '["front", "profile_left", "profile_right", "quarter_left", "quarter_right", "up", "down", "smile"]'::jsonb,
  auto_capture_enabled BOOLEAN DEFAULT TRUE,

  -- Progress
  captured_angles JSONB DEFAULT '{}'::jsonb,  -- { "front": { "url": "...", "quality": 0.95 }, ... }
  total_captures INTEGER DEFAULT 0,

  -- Metadata
  name TEXT,
  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for session code lookup (phone connecting)
CREATE INDEX idx_scan_sessions_code ON phone_scan_sessions(session_code);

-- Index for status filtering
CREATE INDEX idx_scan_sessions_status ON phone_scan_sessions(status);

-- Index for expiry cleanup
CREATE INDEX idx_scan_sessions_expires ON phone_scan_sessions(expires_at) WHERE status NOT IN ('completed', 'expired');


-- Individual captures from scan sessions
CREATE TABLE phone_scan_captures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES phone_scan_sessions(id) ON DELETE CASCADE,

  -- Image
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,

  -- Angle detection
  detected_angle TEXT,              -- 'front', 'profile_left', etc.
  euler_angles JSONB,               -- { pitch, yaw, roll }

  -- Quality metrics
  quality_score DECIMAL(5,4),
  blur_score DECIMAL(5,4),
  face_confidence DECIMAL(5,4),
  bbox JSONB,                       -- Face bounding box { x, y, w, h }

  -- Selection
  is_selected BOOLEAN DEFAULT TRUE,
  is_auto_captured BOOLEAN DEFAULT TRUE,

  captured_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for session lookups
CREATE INDEX idx_scan_captures_session ON phone_scan_captures(session_id);

-- Index for angle lookups within session
CREATE INDEX idx_scan_captures_angle ON phone_scan_captures(session_id, detected_angle);
