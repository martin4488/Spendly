/**
 * La conversión de monedas, y sobre todo su contrato de falla.
 *
 * El bug que motivó estas pruebas: `prefetchRates()` no corría nunca para un
 * usuario que volvía (la sesión cacheada ya había marcado el boot como hecho),
 * así que la tabla de cotizaciones estaba vacía, `convertCurrency` devolvía
 * null y el modal guardaba el monto tal cual en la moneda por defecto — 1000
 * ARS quedaban como 1000 EUR, sin ningún aviso.
 *
 * Lo que se fija acá es el contrato del que depende ese camino: sin
 * cotizaciones la conversión devuelve `null` (nunca el monto de entrada), y
 * `ensureRates()` dice la verdad sobre si hay con qué convertir. Que el modal
 * cancele el guardado cuando es null vive en AddExpenseModal.
 *
 * No necesita red ni credenciales: el fetch está stubbeado.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// currency.ts toca localStorage y fetch. Los dos son del navegador.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const realFetch = globalThis.fetch;
function stubFetch(impl) {
  globalThis.fetch = impl;
  return () => { globalThis.fetch = realFetch; };
}

const okRates = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve({
    result: 'success',
    // Cuántas unidades de cada moneda vale 1 USD.
    rates: { USD: 1, EUR: 0.8, ARS: 1500 },
  }),
});

const { convertCurrency, getRate, ensureRates } = await import('../src/lib/currency.ts');

test('sin cotizaciones la conversión es null, nunca el monto de entrada', () => {
  // El caché arranca frío: es exactamente el estado en el que el modal guardaba
  // 1000 ARS como 1000 EUR.
  assert.equal(getRate('ARS', 'EUR'), null);
  assert.equal(convertCurrency(1000, 'ARS', 'EUR'), null);
  assert.notEqual(convertCurrency(1000, 'ARS', 'EUR'), 1000);
});

test('la misma moneda no necesita cotización', () => {
  assert.equal(getRate('EUR', 'EUR'), 1);
  assert.equal(convertCurrency(1000, 'EUR', 'EUR'), 1000);
});

test('ensureRates dice false cuando no hay con qué convertir', async () => {
  const restore = stubFetch(() => Promise.reject(new Error('offline')));
  try {
    assert.equal(await ensureRates(), false);
    assert.equal(convertCurrency(1000, 'ARS', 'EUR'), null);
  } finally { restore(); }
});

test('ensureRates trae la tabla y recién ahí la conversión da un número', async () => {
  const restore = stubFetch(okRates);
  try {
    assert.equal(await ensureRates(), true);
  } finally { restore(); }

  // 1500 ARS = 1 USD = 0.80 EUR  →  1500 ARS = 0.80 EUR
  assert.equal(convertCurrency(1500, 'ARS', 'EUR'), 0.8);
  assert.equal(convertCurrency(1, 'USD', 'EUR'), 0.8);
  assert.equal(convertCurrency(1, 'USD', 'ARS'), 1500);
  // Ida y vuelta.
  assert.equal(convertCurrency(0.8, 'EUR', 'USD'), 1);
});

test('con la tabla en memoria ensureRates no vuelve a pedir nada', async () => {
  let calls = 0;
  const restore = stubFetch(() => { calls++; return okRates(); });
  try {
    assert.equal(await ensureRates(), true);
    assert.equal(calls, 0);
  } finally { restore(); }
});

test('cotizaciones vencidas se siguen usando antes que no convertir', async () => {
  // Un caché guardado hace dos horas: vencido para el TTL de una hora, pero es
  // lo único que hay estando offline. Vale más una cotización de ayer que
  // guardar el monto sin convertir.
  store.set('spendly_exchange_rates', JSON.stringify({
    base: 'USD',
    rates: { USD: 1, EUR: 0.5, ARS: 1000 },
    timestamp: Date.now() - 2 * 60 * 60 * 1000,
  }));

  const { convertCurrency: convert, ensureRates: ensure } =
    await import(`../src/lib/currency.ts?stale=${Date.now()}`);

  const restore = stubFetch(() => Promise.reject(new Error('offline')));
  try {
    assert.equal(await ensure(), true);
  } finally { restore(); }

  assert.equal(convert(1000, 'ARS', 'EUR'), 0.5);
});
