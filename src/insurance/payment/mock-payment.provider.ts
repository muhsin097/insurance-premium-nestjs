import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface PaymentResult {
  success: boolean;
  transactionId: string;
}

/**
 * Stands in for a real payment gateway. Tokens prefixed `fail_` simulate a
 * declined payment so failure/rollback paths can be exercised deterministically.
 */
@Injectable()
export class MockPaymentProvider {
  async charge(paymentToken: string, _amount: string): Promise<PaymentResult> {
    return {
      success: !paymentToken.startsWith('fail_'),
      transactionId: randomUUID(),
    };
  }
}
