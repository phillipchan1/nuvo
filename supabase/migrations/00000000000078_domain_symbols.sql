-- Native emoji inherit each platform's artwork and do not belong to Nuvo's
-- visual language. Domain compact identity is now a stable Lucide symbol key.
alter table public.domains
  alter column icon set default 'diamond';

with legacy(old_value, symbol_key) as (
  values
    ('💼', 'briefcase'), ('🏢', 'building'), ('💻', 'laptop'),
    ('📈', 'trending-up'), ('🤝', 'handshake'), ('🎯', 'target'),
    ('🛠️', 'hammer'), ('🛠', 'hammer'), ('⚖️', 'scale'), ('⚖', 'scale'),
    ('🩺', 'stethoscope'), ('🎓', 'graduation-cap'),
    ('💰', 'wallet'), ('💵', 'wallet'), ('🏦', 'landmark'),
    ('📊', 'chart'), ('🧾', 'receipt'),
    ('❤️', 'heart-pulse'), ('❤', 'heart-pulse'), ('🏃', 'activity'),
    ('🏋️', 'dumbbell'), ('🏋', 'dumbbell'), ('🧘', 'person-standing'),
    ('🥗', 'salad'), ('😴', 'moon'), ('🩹', 'cross'), ('🚴', 'bike'),
    ('👪', 'heart-handshake'), ('🧑‍🤝‍🧑', 'heart-handshake'),
    ('👶', 'baby'), ('💍', 'gem'), ('🐾', 'paw-print'),
    ('🏡', 'house'), ('🏠', 'house'), ('🧹', 'broom'), ('🔧', 'wrench'),
    ('🌱', 'sprout'), ('🚗', 'car'), ('🙏', 'hand-heart'),
    ('✝️', 'church'), ('✝', 'church'), ('⛪', 'church'),
    ('🕯️', 'flame'), ('🕯', 'flame'), ('🧭', 'compass'),
    ('📚', 'book-open'), ('✍️', 'pen-line'), ('✍', 'pen-line'),
    ('🧠', 'brain'), ('🎨', 'palette'), ('🎵', 'music'),
    ('🎸', 'guitar'), ('📷', 'camera'), ('🎬', 'clapperboard'),
    ('🌍', 'globe'), ('🎉', 'party-popper'), ('🗳️', 'vote'), ('🗳', 'vote'),
    ('🏛️', 'university'), ('🏛', 'university'),
    ('✈️', 'plane'), ('✈', 'plane'), ('🏔️', 'mountain'), ('🏔', 'mountain'),
    ('⛺', 'tent'), ('🎮', 'gamepad'), ('♟️', 'chess-knight'),
    ('♟', 'chess-knight'), ('⚽', 'trophy'), ('➕', 'plus'),
    ('◇', 'diamond'), ('◆', 'diamond')
)
update public.domains as domain
set icon = legacy.symbol_key
from legacy
where domain.icon = legacy.old_value;

-- Free-form values were previously accepted by the agent. Never leak an
-- unknown native glyph back into the UI; unmapped values get the neutral mark.
update public.domains
set icon = 'diamond'
where icon not in (
  'briefcase', 'building', 'laptop', 'code', 'trending-up', 'handshake', 'target',
  'hammer', 'factory', 'store', 'presentation', 'package', 'scale', 'stethoscope',
  'wallet', 'landmark', 'chart', 'analytics', 'receipt', 'heart-pulse', 'activity',
  'dumbbell', 'person-standing', 'salad', 'moon', 'bike', 'footprints', 'cross',
  'heart-handshake', 'baby', 'gem', 'paw-print', 'dog', 'house', 'broom', 'wrench',
  'sprout', 'shopping', 'utensils', 'car', 'hand-heart', 'church', 'flame',
  'compass', 'shield', 'anchor', 'book-open', 'graduation-cap', 'brain',
  'microscope', 'languages', 'palette', 'pen-line', 'music', 'guitar', 'camera',
  'clapperboard', 'scissors', 'globe', 'party-popper', 'vote', 'university',
  'plane', 'mountain', 'tent', 'tree', 'leaf', 'waves', 'sun', 'cloud-sun',
  'gamepad', 'chess-knight', 'trophy', 'coffee', 'diamond', 'circle-dot', 'star',
  'sparkles', 'shapes', 'flower', 'plus'
);
