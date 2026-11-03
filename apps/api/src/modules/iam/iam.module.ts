import { Module } from '@nestjs/common';

/**
 * Module IAM — Identity & Access (17 §2.2), partagé par l'API et le travailleur. Les routes
 * d'authentification et le port (US-010) sont dans `IamAuthModule`, monté par l'API seulement.
 */
@Module({})
export class IamModule {}
