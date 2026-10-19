import { Module } from '@nestjs/common';
import { DecisionsModule } from '../decisions/decisions.module';
import { RotationsController } from './rotations.controller';
import { RotationsService } from './rotations.service';

@Module({ imports: [DecisionsModule], controllers: [RotationsController], providers: [RotationsService], exports: [RotationsService] })
export class RotationsModule {}
