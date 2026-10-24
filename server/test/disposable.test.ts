import { describe, expect, it } from 'vitest';
import { isDisposableDatabaseName } from '../src/db/disposable.js';

describe('isDisposableDatabaseName', () => {
  it('accepts the test, e2e and experiment databases, with an optional nonce', () => {
    for (const name of ['devdigest_test', 'devdigest_e2e', 'devdigest_hw2f', 'devdigest_hw2f_a1b2c3']) {
      expect(isDisposableDatabaseName(name)).toBe(true);
    }
  });

  it('rejects the development database and look-alikes', () => {
    for (const name of ['devdigest', 'devdigest_dev', 'devdigest_e2e_prod_copy', 'devdigest_test_', 'my_devdigest_test', 'postgres', '']) {
      expect(isDisposableDatabaseName(name)).toBe(false);
    }
  });
});
