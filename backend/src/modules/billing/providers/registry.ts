import { Injectable } from '@nestjs/common';
import { ManualProvider } from './manual.provider';
import { MpesaBillingProvider } from './mpesa.provider';
import { PaystackProvider } from './paystack.provider';
import { BillingProvider } from './provider';
import { SandboxProvider } from './sandbox.provider';

/** All subscription-payment providers. Add a new one here and in billing_provider_availability. */
@Injectable()
export class ProviderRegistry {
  private readonly all: BillingProvider[];

  constructor(mpesa: MpesaBillingProvider, paystack: PaystackProvider, manual: ManualProvider, readonly sandbox: SandboxProvider) {
    this.all = [mpesa, paystack, manual, sandbox];
  }

  list() {
    return this.all;
  }

  get(code: string): BillingProvider | undefined {
    return this.all.find((p) => p.code === code);
  }
}
