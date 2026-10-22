import { Global, Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingWebhooksController, GroupBillingController } from './billing.controller';
import { EntitlementService } from './entitlements.service';
import { PlatformBillingController, RegionsController } from './platform-billing.controller';
import { ManualProvider } from './providers/manual.provider';
import { MpesaBillingProvider } from './providers/mpesa.provider';
import { PaystackProvider } from './providers/paystack.provider';
import { ProviderRegistry } from './providers/registry';
import { SandboxProvider } from './providers/sandbox.provider';
import { RevenueService } from './revenue.service';

/** ChamaHub's own subscription billing. Global so the group guard and other modules can check entitlements. */
@Global()
@Module({
  controllers: [GroupBillingController, BillingWebhooksController, PlatformBillingController, RegionsController],
  providers: [EntitlementService, BillingService, RevenueService, ProviderRegistry, MpesaBillingProvider, PaystackProvider, ManualProvider, SandboxProvider],
  exports: [EntitlementService, BillingService, ProviderRegistry],
})
export class BillingModule {}
