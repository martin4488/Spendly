/**
 * iconComponents.ts — the lucide components behind the icon keys in `iconMap.ts`.
 *
 * Split out on purpose: these 75 imports are ~47 kB of ESM and used to sit in the
 * boot chunk (via CategoryIcon → the dashboard rows), where they had to be parsed
 * before anything could paint. Nothing on the critical path imports this module
 * statically — `CategoryIcon` fetches it as its own chunk in parallel with boot,
 * and the lazily-loaded views (add-expense, categories, recurring) that need
 * icons synchronously import it directly into their own chunks.
 */

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

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  'car':              Car,
  'plane':            Plane,
  'utensils':         UtensilsCrossed,
  'user':             User,
  'banknote':         Banknote,
  'drama':            Drama,
  'home':             Home,
  'zap':              Zap,
  'shopping-bag':     ShoppingBag,
  'car-front':        CarFront,
  'stethoscope':      Stethoscope,
  'help-circle':      HelpCircle,
  'shirt':            Shirt,
  'train':            TrainFront,
  'croissant':        Croissant,
  'wine':             Wine,
  'dribbble':         Dribbble,
  'paw-print':        PawPrint,
  'graduation-cap':   GraduationCap,
  'compass':          Compass,
  'heart':            Heart,
  'tractor':          Tractor,
  'landmark':         Landmark,
  'music':            Music,
  'wallet':           Wallet,
  'gift':             Gift,
  'fuel':             Fuel,
  'pipette':          Pipette,
  'piggy-bank':       PiggyBank,
  'armchair':         Armchair,
  'coffee':           Coffee,
  'smartphone':       Smartphone,
  'laptop':           Laptop,
  'gamepad':          Gamepad2,
  'book-open':        BookOpen,
  'baby':             Baby,
  'pill':             Pill,
  'dumbbell':         Dumbbell,
  'brush':            Brush,
  'scissors':         Scissors,
  'newspaper':        Newspaper,
  'hospital':         Hospital,
  'wrench':           Wrench,
  'clapperboard':     Clapperboard,
  'lightbulb':        Lightbulb,
  'dog':              Dog,
  'bus':              Bus,
  'package':          Package,
  'shopping-cart':    ShoppingCart,
  'beer':             Beer,
  'briefcase':        Briefcase,
  'palette':          Palette,
  'globe':            Globe,
  'umbrella':         Umbrella,
  'toy-brick':        ToyBrick,
  'gem':              Gem,
  'cake':             Cake,
  'flask':            FlaskConical,
  'camera':           Camera,
  'flower':           Flower2,
  'credit-card':      CreditCard,
  'sparkles':         Sparkles,
  'receipt':          Receipt,
  'circle-dollar':    CircleDollarSign,
  'repeat':           Repeat,
  'apple':            Apple,
  'monitor':          Monitor,
  'star':             Star,
  'map-pin':          MapPin,
  'ticket':           Ticket,
  'hand-coins':       HandCoins,
  'badge-dollar':     BadgeDollarSign,
};

export default ICON_COMPONENTS;
export type { LucideIcon };

/** Get the LucideIcon component for a given icon key. Falls back to Package. */
export function getIconComponent(key: string): LucideIcon {
  return ICON_COMPONENTS[key] ?? Package;
}
