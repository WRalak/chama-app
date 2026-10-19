import { Module } from '@nestjs/common';
import { ContributionsModule } from '../contributions/contributions.module';
import { DarajaClient } from './daraja.client';
import { MpesaController } from './mpesa.controller';
import { MpesaService } from './mpesa.service';

@Module({ imports: [ContributionsModule], controllers: [MpesaController], providers: [MpesaService, DarajaClient] })
export class MpesaModule {}
