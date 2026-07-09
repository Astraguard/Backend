import { describe, expect, it } from 'vitest';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../src/shared/errors.js';
import { isValidStellarAddress } from '../src/shared/stellar.js';

describe('errors', () => {
  it('NotFoundError carries a 404 status and code', () => {
    const err = new NotFoundError('Claim');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Claim not found');
  });

  it('ValidationError carries a 400 status', () => {
    expect(new ValidationError('bad input').statusCode).toBe(400);
  });

  it('ConflictError carries a 409 status', () => {
    expect(new ConflictError('already confirmed').statusCode).toBe(409);
  });
});

describe('isValidStellarAddress', () => {
  it('accepts a well-formed account address (G...)', () => {
    expect(isValidStellarAddress('G' + 'A'.repeat(55))).toBe(true);
  });

  it('accepts a well-formed contract address (C...)', () => {
    expect(isValidStellarAddress('C' + 'A'.repeat(55))).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidStellarAddress('not-an-address')).toBe(false);
    expect(isValidStellarAddress('G' + 'A'.repeat(10))).toBe(false);
  });
});
