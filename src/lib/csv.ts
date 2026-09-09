/**
 * csv.ts
 *
 * Las dos mitades del mismo formato: lo que exporta Ajustes y lo que ese mismo
 * archivo tiene que poder volver a importar. Vivían separadas —el escape en
 * `utils.ts`, el parser adentro de `SettingsView`— y no coincidían:
 *
 *  - El escape sólo entrecomillaba los valores con coma, así que una comilla o
 *    un salto de línea en la descripción rompían el archivo.
 *  - El parser trataba `""` como dos delimitadores (se comía la comilla) y
 *    partía por `\n` antes de mirar las comillas, así que un salto de línea
 *    adentro de un campo corría todo el resto del archivo.
 *
 * Ahora las dos siguen RFC 4180 y `tests/csv.test.mjs` prueba el viaje de ida y
 * vuelta. Este módulo no usa alias `@/` a propósito, para que el test pueda
 * importarlo directo desde Node.
 */

/** Entrecomilla si hace falta y duplica las comillas de adentro. */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Filas de objetos → texto CSV, con las claves del primero como encabezado. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map(row => headers.map(h => escapeCsvCell(row[h])).join(',')),
  ].join('\n');
}

/**
 * Texto CSV → matriz de celdas. Recorre el texto entero carácter por carácter
 * (no línea por línea) para que un salto de línea entrecomillado siga siendo
 * parte de la celda. Descarta las filas totalmente vacías, incluida la última.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }  // comilla escapada
        else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);

  return rows.filter(r => r.some(c => c.trim() !== ''));
}
