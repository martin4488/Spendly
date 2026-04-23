import {
  Car, Plane, UtensilsCrossed, User, Banknote, Drama, Home, Zap,
  ShoppingBag, CarFront, Stethoscope, HelpCircle, Shirt, TrainFront,
  Croissant, Wine, Dribbble, PawPrint, GraduationCap, Compass,
  Heart, Tractor, Landmark, Music, Wallet, Gift, Fuel, Pipette,
  PiggyBank, Armchair, Coffee, Smartphone, Laptop, Gamepad2, BookOpen,
  Baby, Pill, Dumbbell, Brush, Scissors, Newspaper, Hospital, Wrench,
  Clapperboard, Lightbulb, Dog, Bus, Package, ShoppingCart, Beer,
  Briefcase, Palette, Globe, Umbrella, ToyBrick, Gem, Cake, FlaskConical,
  Camera, Flower2, CreditCard, Sparkles, Receipt, CircleDollarSign,
  Repeat, Apple, Monitor, Star, MapPin, Ticket, HandCoins, BadgeDollarSign,
  type LucideIcon,
} from 'lucide-react';

export interface IconEntry {
  component: LucideIcon;
  emoji: string; // fallback for SVG <text> / plain strings
}

// ── Master icon registry ─────────────────────────────────────────────────────
// Keys = what gets stored in the DB `icon` column (lowercase kebab-case).
const ICON_MAP: Record<string, IconEntry> = {
  'car':              { component: Car,              emoji: '🚗' },
  'plane':            { component: Plane,            emoji: '✈️' },
  'utensils':         { component: UtensilsCrossed,  emoji: '🍴' },
  'user':             { component: User,             emoji: '👤' },
  'banknote':         { component: Banknote,         emoji: '💵' },
  'drama':            { component: Drama,            emoji: '🎭' },
  'home':             { component: Home,             emoji: '🏠' },
  'zap':              { component: Zap,              emoji: '⚡' },
  'shopping-bag':     { component: ShoppingBag,      emoji: '🛍️' },
  'car-front':        { component: CarFront,         emoji: '🚙' },
  'stethoscope':      { component: Stethoscope,      emoji: '🩺' },
  'help-circle':      { component: HelpCircle,       emoji: '❓' },
  'shirt':            { component: Shirt,            emoji: '👕' },
  'train':            { component: TrainFront,       emoji: '🚇' },
  'croissant':        { component: Croissant,        emoji: '🥐' },
  'wine':             { component: Wine,             emoji: '🍸' },
  'dribbble':         { component: Dribbble,         emoji: '⚽' },
  'paw-print':        { component: PawPrint,         emoji: '🐾' },
  'graduation-cap':   { component: GraduationCap,    emoji: '🎓' },
  'compass':          { component: Compass,          emoji: '🧭' },
  'heart':            { component: Heart,            emoji: '❤️' },
  'tractor':          { component: Tractor,          emoji: '🚜' },
  'landmark':         { component: Landmark,         emoji: '🏦' },
  'music':            { component: Music,            emoji: '🎵' },
  'wallet':           { component: Wallet,           emoji: '👛' },
  'gift':             { component: Gift,             emoji: '🎁' },
  'fuel':             { component: Fuel,             emoji: '⛽' },
  'pipette':          { component: Pipette,          emoji: '🧴' },
  'piggy-bank':       { component: PiggyBank,        emoji: '💰' },
  'armchair':         { component: Armchair,         emoji: '🪑' },
  'coffee':           { component: Coffee,           emoji: '☕' },
  'smartphone':       { component: Smartphone,       emoji: '📱' },
  'laptop':           { component: Laptop,           emoji: '💻' },
  'gamepad':          { component: Gamepad2,         emoji: '🎮' },
  'book-open':        { component: BookOpen,         emoji: '📚' },
  'baby':             { component: Baby,             emoji: '👶' },
  'pill':             { component: Pill,             emoji: '💊' },
  'dumbbell':         { component: Dumbbell,         emoji: '🏋️' },
  'brush':            { component: Brush,            emoji: '🧹' },
  'scissors':         { component: Scissors,         emoji: '💇' },
  'newspaper':        { component: Newspaper,        emoji: '📰' },
  'hospital':         { component: Hospital,         emoji: '🏥' },
  'wrench':           { component: Wrench,           emoji: '🔧' },
  'clapperboard':     { component: Clapperboard,     emoji: '🎬' },
  'lightbulb':        { component: Lightbulb,        emoji: '💡' },
  'dog':              { component: Dog,              emoji: '🐕' },
  'bus':              { component: Bus,              emoji: '🚌' },
  'package':          { component: Package,          emoji: '📦' },
  'shopping-cart':    { component: ShoppingCart,      emoji: '🛒' },
  'beer':             { component: Beer,             emoji: '🍺' },
  'briefcase':        { component: Briefcase,        emoji: '🧑‍💼' },
  'palette':          { component: Palette,          emoji: '🎨' },
  'globe':            { component: Globe,            emoji: '🌍' },
  'umbrella':         { component: Umbrella,         emoji: '🏖️' },
  'toy-brick':        { component: ToyBrick,         emoji: '🧸' },
  'gem':              { component: Gem,              emoji: '💎' },
  'cake':             { component: Cake,             emoji: '🎂' },
  'flask':            { component: FlaskConical,     emoji: '🧪' },
  'camera':           { component: Camera,           emoji: '📸' },
  'flower':           { component: Flower2,          emoji: '🪴' },
  'credit-card':      { component: CreditCard,       emoji: '💳' },
  'sparkles':         { component: Sparkles,         emoji: '✨' },
  'receipt':          { component: Receipt,          emoji: '🧾' },
  'circle-dollar':    { component: CircleDollarSign, emoji: '💲' },
  'repeat':           { component: Repeat,           emoji: '🔄' },
  'apple':            { component: Apple,            emoji: '🍎' },
  'monitor':          { component: Monitor,          emoji: '🖥️' },
  'star':             { component: Star,             emoji: '⭐' },
  'map-pin':          { component: MapPin,           emoji: '📍' },
  'ticket':           { component: Ticket,           emoji: '🎟️' },
  'hand-coins':       { component: HandCoins,        emoji: '💸' },
  'badge-dollar':     { component: BadgeDollarSign,  emoji: '💰' },
};

export default ICON_MAP;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get the LucideIcon component for a given icon key. Falls back to Package. */
export function getIconComponent(key: string): LucideIcon {
  return ICON_MAP[key]?.component ?? Package;
}

/** Get the emoji fallback for places where React components can't render (SVG <text>, plain strings). */
export function getIconEmoji(key: string): string {
  return ICON_MAP[key]?.emoji ?? '📦';
}

/** All available icon keys for the picker UI. */
export const ICON_KEYS = Object.keys(ICON_MAP);

// ── Emoji → key migration map ────────────────────────────────────────────────
// Used by the SQL migration and by runtime fallback (if DB still has emojis).
export const EMOJI_TO_KEY: Record<string, string> = {};
for (const [key, entry] of Object.entries(ICON_MAP)) {
  EMOJI_TO_KEY[entry.emoji] = key;
}

/** Normalize an icon value: if it's an emoji, convert to key. If already a key, return as-is. */
export function normalizeIcon(iconValue: string): string {
  if (ICON_MAP[iconValue]) return iconValue;        // already a lucide key
  if (EMOJI_TO_KEY[iconValue]) return EMOJI_TO_KEY[iconValue]; // emoji → key
  return 'package';                                   // unknown fallback
}
