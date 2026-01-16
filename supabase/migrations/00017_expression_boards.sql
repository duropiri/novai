-- Rename emotion_boards to expression_boards and add board types
-- This migration transforms the simple emotion board into a comprehensive expression board system

-- Rename the table
ALTER TABLE emotion_boards RENAME TO expression_boards;

-- Add board_type column to support multiple expression categories
ALTER TABLE expression_boards
ADD COLUMN board_types TEXT[] DEFAULT ARRAY['emotion', 'playful', 'glamour', 'casual', 'angles'];

-- Add subject_profile to store analyzed subject details for prompt generation
ALTER TABLE expression_boards
ADD COLUMN subject_profile JSONB DEFAULT NULL;

-- Update the grid_size to support more options
ALTER TABLE expression_boards
DROP CONSTRAINT IF EXISTS emotion_boards_grid_size_check;

ALTER TABLE expression_boards
ADD CONSTRAINT expression_boards_grid_size_check
CHECK (grid_size IN ('2x4', '2x8', '4x8', '5x8'));

-- Rename emotions column to expressions for clarity
ALTER TABLE expression_boards RENAME COLUMN emotions TO expressions;

-- Update indexes
DROP INDEX IF EXISTS idx_emotion_boards_status;
CREATE INDEX idx_expression_boards_status ON expression_boards(status);

-- Add index for board_types array queries
CREATE INDEX idx_expression_boards_types ON expression_boards USING GIN(board_types);
