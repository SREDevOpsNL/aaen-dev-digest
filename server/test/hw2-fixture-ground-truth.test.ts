import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as vm from 'node:vm';
import { EXPERIMENT_FIXTURES } from '../src/db/seed-fixtures.js';

const addedSource = (patch: string) =>
  patch.split('\n').filter((line) => line.startsWith('+')).map((line) => line.slice(1)).join('\n');

const patchedSource = (patch: string) =>
  patch.split('\n').filter((line) => line.startsWith('+') || line.startsWith(' ')).map((line) => line.slice(1)).join('\n');

describe('HW2 fixture ground truth', () => {
  it('executes the coupon boundary and error branches absent from the fixture tests', () => {
    const fixture = EXPERIMENT_FIXTURES.find((item) => item.number === 501)!;
    const source = addedSource(fixture.files.find((file) => file.path === 'src/billing/discount.ts')!.patch);
    const tests = addedSource(fixture.files.find((file) => file.path === 'src/billing/discount.test.ts')!.patch);
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(output, { exports, Date, Error, Math });
    const applyDiscount = exports.applyDiscount as (total: number, code: string, now: Date) => number;
    const expiry = new Date('2027-01-01T00:00:00Z');
    expect(applyDiscount(10_000, 'SAVE10', new Date(expiry.getTime() - 1))).toBe(9_000);
    expect(() => applyDiscount(10_000, 'SAVE10', expiry)).toThrow('Coupon expired');
    expect(() => applyDiscount(10_000, 'SAVE10', new Date(expiry.getTime() + 1))).toThrow('Coupon expired');
    expect(() => applyDiscount(10_000, 'UNKNOWN', new Date(expiry.getTime() - 1))).toThrow('Unknown coupon');
    expect(tests).not.toMatch(/toThrow|2027-01-01|UNKNOWN/);
  });

  it('executes the patched route: an old ID URL still matches but its lookup returns 404', async () => {
    const fixture = EXPERIMENT_FIXTURES.find((item) => item.number === 502)!;
    const routePatch = fixture.files.find((file) => file.path === 'src/api/payments.ts')!.patch;
    const storePatch = fixture.files.find((file) => file.path === 'src/payments/store.ts')!.patch;
    expect(routePatch).toContain("app.get('/v1/payments/:id'");
    expect(storePatch).toContain('return db.payments.findOne({ reference });');
    const routeSource = patchedSource(routePatch);
    const source = 'export async function registerPaymentRoutes(app: any) {\n' + routeSource + '\n}';
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports: Record<string, unknown> = {};
    const payment = { id: 'pay_123', reference: 'ref_abc' };
    vm.runInNewContext(output, {
      exports,
      findPaymentByReference: async (reference: string) =>
        [payment].find((item) => item.reference === reference) ?? null,
    });
    let path = '';
    let handler: ((request: { params: { reference: string } }, reply: {
      code: (status: number) => { send: (body: unknown) => unknown };
    }) => Promise<unknown>) | undefined;
    const register = exports.registerPaymentRoutes as (app: {
      get: (route: string, callback: typeof handler) => void;
    }) => Promise<void>;
    await register({ get: (route, callback) => { path = route; handler = callback; } });
    const oldIdUrl = '/v1/payments/pay_123';
    const matches = (pattern: string, url: string) =>
      new RegExp('^' + pattern.replace(/:[^/]+/g, '[^/]+') + '$').test(url);
    expect(matches('/v1/payments/:id', oldIdUrl)).toBe(true);
    expect(matches(path, oldIdUrl)).toBe(true);
    expect([payment].find((item) => item.id === 'pay_123')).toBeDefined();
    let status = 200;
    const reply = {
      code: (value: number) => {
        status = value;
        return { send: (body: unknown) => body };
      },
    };
    await handler!({ params: { reference: 'pay_123' } }, reply);
    expect(status).toBe(404);
  });
});
