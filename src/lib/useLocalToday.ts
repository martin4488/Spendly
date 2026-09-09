/**
 * useLocalToday.ts
 *
 * El día local de hoy ('yyyy-MM-dd'), recalculado cuando el día cambia de
 * verdad.
 *
 * Por qué existe: el dashboard resolvía `todayStr()`, `getMonth()` y
 * `getFullYear()` con `useMemo(..., [])`, o sea una sola vez al montar. La app
 * es una PWA que queda abierta días entre usos, así que pasada la medianoche los
 * gastos de hoy quedaban etiquetados "Ayer", y al cambiar de mes el gráfico
 * seguía apuntando a la ventana de seis meses vieja. El sync por foreground
 * traía datos nuevos pero nunca recalculaba la fecha con la que se los rotula.
 *
 * Se despierta por dos vías, igual que `useSyncOnForeground`: un timer hasta la
 * próxima medianoche local (para la app que queda visible) y visibility/focus
 * (para la que volvió del fondo, donde el timer pudo no haber corrido).
 */

import { useEffect, useState } from 'react';
import { todayStr } from '@/lib/dateUtils';

export function useLocalToday(): string {
  const [today, setToday] = useState(todayStr);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      // Sólo cambia la referencia si cambió el día: si no, cada foco de ventana
      // re-renderizaría la lista entera para nada.
      setToday(prev => {
        const now = todayStr();
        return now === prev ? prev : now;
      });
      schedule();
    };

    const schedule = () => {
      clearTimeout(timer);
      const now = new Date();
      // Medianoche local + 5 s de margen, construida con el constructor local
      // (ver dateUtils: nada de ISO acá).
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timer = setTimeout(check, Math.max(1000, next.getTime() - now.getTime()));
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', check);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', check);
    };
  }, []);

  return today;
}
