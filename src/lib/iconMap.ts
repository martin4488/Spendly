/**
 * iconMap.ts — the icon *registry*: keys, emoji fallbacks and normalization.
 *
 * Deliberately free of imports. The 75 matching lucide components live in
 * `iconComponents.ts`, which is ~47 kB of ESM; keeping them out of here means
 * `CategoryIcon` (rendered on the dashboard, i.e. the critical path) can pull
 * them in as a separate chunk in parallel with boot instead of blocking first
 * paint on them.
 */

// Keys = what gets stored in the DB `icon` column (lowercase kebab-case).
const ICON_EMOJI: Record<string, string> = {
  'car':              '🚗',
  'plane':            '✈️',
  'utensils':         '🍴',
  'user':             '👤',
  'banknote':         '💵',
  'drama':            '🎭',
  'home':             '🏠',
  'zap':              '⚡',
  'shopping-bag':     '🛍️',
  'car-front':        '🚙',
  'stethoscope':      '🩺',
  'help-circle':      '❓',
  'shirt':            '👕',
  'train':            '🚇',
  'croissant':        '🥐',
  'wine':             '🍸',
  'dribbble':         '⚽',
  'paw-print':        '🐾',
  'graduation-cap':   '🎓',
  'compass':          '🧭',
  'heart':            '❤️',
  'tractor':          '🚜',
  'landmark':         '🏦',
  'music':            '🎵',
  'wallet':           '👛',
  'gift':             '🎁',
  'fuel':             '⛽',
  'pipette':          '🧴',
  'piggy-bank':       '💰',
  'armchair':         '🪑',
  'coffee':           '☕',
  'smartphone':       '📱',
  'laptop':           '💻',
  'gamepad':          '🎮',
  'book-open':        '📚',
  'baby':             '👶',
  'pill':             '💊',
  'dumbbell':         '🏋️',
  'brush':            '🧹',
  'scissors':         '💇',
  'newspaper':        '📰',
  'hospital':         '🏥',
  'wrench':           '🔧',
  'clapperboard':     '🎬',
  'lightbulb':        '💡',
  'dog':              '🐕',
  'bus':              '🚌',
  'package':          '📦',
  'shopping-cart':    '🛒',
  'beer':             '🍺',
  'briefcase':        '🧑‍💼',
  'palette':          '🎨',
  'globe':            '🌍',
  'umbrella':         '🏖️',
  'toy-brick':        '🧸',
  'gem':              '💎',
  'cake':             '🎂',
  'flask':            '🧪',
  'camera':           '📸',
  'flower':           '🪴',
  'credit-card':      '💳',
  'sparkles':         '✨',
  'receipt':          '🧾',
  'circle-dollar':    '💲',
  'repeat':           '🔄',
  'apple':            '🍎',
  'monitor':          '🖥️',
  'star':             '⭐',
  'map-pin':          '📍',
  'ticket':           '🎟️',
  'hand-coins':       '💸',
  'badge-dollar':     '💰',
};

export default ICON_EMOJI;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get the emoji fallback for places where React components can't render (SVG <text>, plain strings). */
export function getIconEmoji(key: string): string {
  return ICON_EMOJI[key] ?? '📦';
}

/** All available icon keys for the picker UI. */
export const ICON_KEYS = Object.keys(ICON_EMOJI);

// ── Emoji → key migration map ────────────────────────────────────────────────
// Used by the SQL migration and by runtime fallback (if DB still has emojis).
export const EMOJI_TO_KEY: Record<string, string> = {};
for (const [key, emoji] of Object.entries(ICON_EMOJI)) {
  EMOJI_TO_KEY[emoji] = key;
}

/** Normalize an icon value: if it's an emoji, convert to key. If already a key, return as-is. */
export function normalizeIcon(iconValue: string): string {
  if (ICON_EMOJI[iconValue]) return iconValue;                 // already a lucide key
  if (EMOJI_TO_KEY[iconValue]) return EMOJI_TO_KEY[iconValue]; // emoji → key
  return 'package';                                            // unknown fallback
}
