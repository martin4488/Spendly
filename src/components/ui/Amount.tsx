import { amountParts, currencySymbol, type CurrencyCode } from '@/lib/currency';
import { getDefaultCurrency, DEFAULT_CURRENCY } from '@/lib/currencyState';

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
  /** When false, rounds to integer and hides decimals */
  decimals?: boolean;
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
  decimals = true,
  className = '',
}: Props) {
  // El formateo vive en `currency.ts` para que esto y `formatCurrency` no puedan
  // divergir — durante un tiempo pintaron `€1.234.567,89` y `€1,234,567.89`.
  const { negative, int: intFmt, dec } = amountParts(value, decimals);

  const finalSign = sign !== undefined ? sign : (negative ? '-' : '');

  const sym = currencySymbol(currency || getDefaultCurrency() || DEFAULT_CURRENCY);
  const { n, d } = sizeMap[size];

  return (
    <span className={`font-mono tabular-nums tracking-tight ${n} ${weightMap[weight]} ${color} ${className}`}>
      {finalSign}{sym}{intFmt}
      {dec && <span className={`${d} opacity-60 font-medium`}>,{dec}</span>}
    </span>
  );
}
