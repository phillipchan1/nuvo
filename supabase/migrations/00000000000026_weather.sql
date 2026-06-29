-- Show weather icons in calendar day headers (requires location permission).
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS show_weather boolean DEFAULT false;
