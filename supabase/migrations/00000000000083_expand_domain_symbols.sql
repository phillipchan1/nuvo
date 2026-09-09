-- Expand the domain symbol vocabulary. Native emoji that map cleanly to the new
-- Lucide keys are migrated; anything else stays as-is (already a stable key).
with legacy(old_value, symbol_key) as (
  values
    ('📱', 'smartphone'), ('🚀', 'rocket'), ('💡', 'lightbulb'),
    ('🧪', 'flask-conical'), ('📢', 'megaphone'), ('👥', 'users'),
    ('📧', 'mail'), ('✉️', 'mail'), ('✉', 'mail'),
    ('🎙️', 'mic'), ('🎙', 'mic'), ('🎧', 'headphones'),
    ('💊', 'pill'), ('🏥', 'hospital'), ('⏰', 'clock'),
    ('📅', 'calendar'), ('📍', 'map-pin'), ('👑', 'crown'),
    ('⚡', 'zap'), ('🤖', 'bot'), ('☁️', 'cloud'), ('☁', 'cloud'),
    ('🖥️', 'monitor'), ('🖥', 'monitor')
)
update public.domains as domain
set icon = legacy.symbol_key
from legacy
where domain.icon = legacy.old_value;
