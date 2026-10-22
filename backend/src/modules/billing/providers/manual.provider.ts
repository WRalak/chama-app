import { Injectable } from '@nestjs/common';
import { env } from '../../../config/env';
import { BillingProvider, ChargeRequest, ProviderStatus } from './provider';

/**
 * Bank transfer or invoice. There is no API: finance staff confirm the payment after seeing it
 * on ChamaHub's bank statement, which is recorded with their name and the bank reference.
 */
@Injectable()
export class ManualProvider implements BillingProvider {
  readonly code = 'MANUAL';
  readonly displayName = 'Bank transfer / invoice';

  configured() {
    return !!env().BILLING_MANUAL_INSTRUCTIONS?.trim() || env().NODE_ENV !== 'production';
  }

  livemode() {
    return env().NODE_ENV === 'production';
  }

  health() {
    return { configured: this.configured(), environment: this.livemode() ? ('live' as const) : ('test' as const), note: 'Confirmed by finance staff against the bank statement.' };
  }

  async initiate(charge: ChargeRequest) {
    const instructions = (env().BILLING_MANUAL_INSTRUCTIONS ?? 'Bank details are not configured yet (BILLING_MANUAL_INSTRUCTIONS).').split('|').map((s) => s.trim());
    return { providerRef: null, action: { type: 'INSTRUCTIONS' as const, message: `Pay by bank transfer using reference ${charge.reference}. Your plan starts once ChamaHub confirms the money arrived.`, instructions } };
  }

  async fetchStatus(): Promise<ProviderStatus> {
    return { status: 'PENDING' };
  }
}
