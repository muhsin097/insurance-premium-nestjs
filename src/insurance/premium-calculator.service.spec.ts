import { describe, expect, it } from 'vitest';
import { PremiumCalculatorService } from './premium-calculator.service.js';

describe('PremiumCalculatorService', () => {
  const calculator = new PremiumCalculatorService();

  it('charges only the base premium when no loading applies', () => {
    const result = calculator.calculate(30, false);
    expect(result.basePremium.toString()).toBe('10000');
    expect(result.loadingFee.toString()).toBe('0');
    expect(result.totalPremium.toString()).toBe('10000');
  });

  it('adds a 50% age loading fee when age is over 45', () => {
    const result = calculator.calculate(46, false);
    expect(result.loadingFee.toString()).toBe('5000');
    expect(result.totalPremium.toString()).toBe('15000');
  });

  it('does not add the age loading fee at exactly 45', () => {
    const result = calculator.calculate(45, false);
    expect(result.loadingFee.toString()).toBe('0');
    expect(result.totalPremium.toString()).toBe('10000');
  });

  it('adds a flat 5000 loading fee for pre-existing conditions', () => {
    const result = calculator.calculate(30, true);
    expect(result.loadingFee.toString()).toBe('5000');
    expect(result.totalPremium.toString()).toBe('15000');
  });

  it('combines both loading fees when age > 45 and conditions exist', () => {
    const result = calculator.calculate(50, true);
    expect(result.loadingFee.toString()).toBe('10000');
    expect(result.totalPremium.toString()).toBe('20000');
  });
});
