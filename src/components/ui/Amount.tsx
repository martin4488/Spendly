import { CURRENCIES, CurrencyCode } from '@/lib/currency';
import { getDefaultCurrency } from '@/lib/utils';

type Props = {
  /** The numeric value to display */
  value: number;
  /** Currency code — uses symbol from CURRENCIES map. Defaults to app's default currency */
  currency?: CurrencyCode | string;
  /** Force a sign prefix. If omitted, shows '-' only for negatives */
  sign?: '-' | '+' | '';
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  /** Tailwind text-color class, e.g. 'text-red-400' */
  color?: string;
  weight?: 'medium' | 'semibold' | 'bold' | 'extrabold';
  className?: string;
};

const sizeMap = {
  sm:   { n: 'text-sm',   d: 'text-[10px]' },
  md:   { n: 'text-base', d: 'text-[11px]' },
  lg:   { n: 'text-xl',   d: 'text-sm' },
  xl:   { n: 'text-3xl',  d: 'text-lg' },
  hero: { n: 'text-5xl',  d: 'text-2xl' },
};

const weightMap = {
  medium:    'font-medium',
  semibold:  'font-semibold',
  bold:      'font-bold',
  extrabold: 'font-extrabold',
};

export default function Amount({
  value,
  currency,
  sign,
  size = 'md',
  color = '',
  weight = 'bold',
  className = '',
}: Props) {
  const resolvedCurrency = (currency || getDefaultCurrency() || 'USD') as CurrencyCode;
  const abs = Math.abs(value);
  const fixed = abs.toFixed(2);
  const [intRaw, dec] = fixed.split('.');

  // Format integer part with locale dots (1234 → 1.234)
  const intFmt = Number(intRaw).toLocaleString('es-AR');

  const finalSign = sign !== undefined ? sign : (value < 0 ? '-' : '');

  const sym = CURRENCIES[resolvedCurrency]?.symbol || '$';
  const { n, d } = sizeMap[size];

  return (
    <span className={`font-mono tabular-nums tracking-tight ${n} ${weightMap[weight]} ${color} ${className}`}>
      {finalSign}{sym}{intFmt}
      <span className={`${d} opacity-60 font-medium`}>,{dec}</span>
    </span>
  );
}
