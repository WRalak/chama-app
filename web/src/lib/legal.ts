import type { LegalOperator } from '@chamahub/shared';

/** Operator details for the Privacy Policy and Terms, from web/.env (NEXT_PUBLIC_*, inlined at build time). */
export const legalOperator: LegalOperator = {
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME,
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS,
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
  odpcRegistration: process.env.NEXT_PUBLIC_ODPC_REGISTRATION,
};
