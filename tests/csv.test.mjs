/**
 * El CSV de Ajustes: lo que exporta tiene que poder volver a entrar.
 *
 * Las dos mitades vivían separadas y no coincidían — el escape sólo miraba las
 * comas, y el parser se comía las comillas escapadas y partía por `\n` antes de
 * mirar si estaba adentro de un campo entrecomillado. Un gasto con una comilla
 * o un salto de línea en la descripción salía bien y volvía mal (o corría todo
 * el resto del archivo una columna).
 *
 * No necesita red ni credenciales.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeCsvCell, toCsv, parseCsvRows } from '../src/lib/csv.ts';

test('escapa sólo lo que hace falta', () => {
  assert.equal(escapeCsvCell('simple'), 'simple');
  assert.equal(escapeCsvCell(1500), '1500');
  assert.equal(escapeCsvCell(null), '');
  assert.equal(escapeCsvCell(undefined), '');
  assert.equal(escapeCsvCell('con,coma'), '"con,coma"');
  assert.equal(escapeCsvCell('con"comilla'), '"con""comilla"');
  assert.equal(escapeCsvCell('con\nsalto'), '"con\nsalto"');
});

test('una comilla escapada es una comilla, no dos delimitadores', () => {
  // El parser viejo alternaba `inQuotes` en cada `"`, así que `""` se comía las
  // dos y el campo salía vacío.
  assert.deepEqual(parseCsvRows('a,"di ""hola""",b'), [['a', 'di "hola"', 'b']]);
});

test('un salto de línea entrecomillado no abre una fila nueva', () => {
  assert.deepEqual(
    parseCsvRows('fecha,nota\n2026-01-06,"linea uno\nlinea dos"\n2026-01-07,ok'),
    [['fecha', 'nota'], ['2026-01-06', 'linea uno\nlinea dos'], ['2026-01-07', 'ok']],
  );
});

test('acepta CRLF y descarta las filas vacías del final', () => {
  assert.deepEqual(
    parseCsvRows('a,b\r\n1,2\r\n\r\n'),
    [['a', 'b'], ['1', '2']],
  );
});

test('exportar e importar devuelve exactamente lo mismo', () => {
  const filas = [
    { Fecha: '2026-01-05', Descripcion: 'Café, con "leche"', Monto: '1500' },
    { Fecha: '2026-01-06', Descripcion: 'Nota\ncon salto', Monto: '200' },
    { Fecha: '2026-01-07', Descripcion: '', Monto: '30' },
  ];

  // El BOM que antepone `exportToCSV` para Excel: `trim()` se lo lleva, que es
  // lo que hace `parseCSV` en SettingsView antes de tokenizar.
  const texto = '﻿' + toCsv(filas);
  const tabla = parseCsvRows(texto.trim());

  assert.deepEqual(tabla[0], ['Fecha', 'Descripcion', 'Monto']);
  assert.equal(tabla.length, filas.length + 1);
  for (const [i, fila] of filas.entries()) {
    assert.deepEqual(tabla[i + 1], [fila.Fecha, fila.Descripcion, fila.Monto]);
  }
});

test('sin filas no hay archivo', () => {
  assert.equal(toCsv([]), '');
});
