/**
 * Privacy policy and terms of use, shared by the web and mobile apps so both always show the
 * same text. Operator details come from each app's configuration; until they are set the
 * documents are marked as drafts. Have a Kenyan advocate review both before launch.
 */

export interface LegalOperator {
  /** Registered name of the company that runs ChamaHub. */
  legalName?: string;
  /** Physical / postal address shown for contact and data-protection requests. */
  address?: string;
  /** Contact e-mail for privacy and support requests. */
  email?: string;
  /** ODPC registration number, once registered as a data controller/processor. */
  odpcRegistration?: string;
}

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  draft: boolean;
  intro: string;
  sections: LegalSection[];
}

export const LEGAL_UPDATED = '2026-10-22';

const orUnset = (v: string | undefined, label: string) => (v && v.trim() ? v.trim() : `[${label} — not yet configured]`);

export function isLegalConfigured(o: LegalOperator) {
  return !!(o.legalName?.trim() && o.address?.trim() && o.email?.trim());
}

export function privacyPolicy(o: LegalOperator): LegalDocument {
  const name = orUnset(o.legalName, 'Company legal name');
  const email = orUnset(o.email, 'Privacy contact e-mail');
  const address = orUnset(o.address, 'Postal and physical address');
  return {
    title: 'Privacy Policy',
    updated: LEGAL_UPDATED,
    draft: !isLegalConfigured(o),
    intro: `ChamaHub is operated by ${name} ("we"). This policy explains what personal data ChamaHub keeps, why, who can see it and the choices you have. It applies to the ChamaHub mobile app and website. We process personal data in line with the Kenya Data Protection Act, 2019.`,
    sections: [
      {
        heading: 'What we collect',
        bullets: [
          'Account details: your full name, mobile number, optional e-mail address and a scrambled (hashed) version of your password. We never store your password in readable form.',
          'Chama records: your memberships and roles, contributions, payments, payment references (such as M-Pesa transaction codes), loans, fines, payouts, votes, meeting attendance and the receipts or screenshots you or your officers attach.',
          'Security records: the devices you are signed in on, the network (IP) address used, sign-in attempts and an audit log of important actions in each group.',
          'Messages you send us, and questions you ask the optional AI assistant.',
          'Notification preferences and, if you allow push notifications, a device push token.',
        ],
      },
      {
        heading: 'What we never collect',
        bullets: [
          'Your M-Pesa PIN, bank password or one-time codes from your bank or mobile-money provider. ChamaHub will never ask for them. Anyone who asks for them is not ChamaHub.',
          'Your SMS inbox or other apps’ data. ChamaHub does not read your messages.',
          'Advertising or tracking identifiers. We do not sell personal data or show advertising.',
        ],
      },
      {
        heading: 'Why we use it',
        bullets: [
          'To run your account and the Chamas you belong to: keeping accurate group records, reconciling payments, scheduling payouts and producing statements (performance of our agreement with you and your group).',
          'To keep accounts and money records safe: verifying your phone number, detecting misuse and keeping an audit trail (legitimate interest and legal obligation).',
          'To send the reminders and notices you choose (your consent, which you can change at any time in your notification settings).',
          'To answer support requests.',
        ],
      },
      {
        heading: 'Who can see your data',
        bullets: [
          'Officers of your Chama (for example the treasurer, chairperson, secretary or auditor) can see the group records their role allows. Ordinary members see their own records and group-level information; they do not see other members’ balances unless your group turns this on. You can hide your phone number from ordinary members in Privacy settings.',
          'ChamaHub staff cannot see a group’s finances unless the group’s chairperson approves a time-limited support request. Every such access is recorded.',
          'Service providers that help us run ChamaHub, only for that purpose: our hosting and database provider; SMS delivery (Africa’s Talking) and WhatsApp Business messages, if enabled; Safaricom M-Pesa, if your group uses in-app M-Pesa payments; e-mail delivery; and, only when you use the AI assistant, the AI provider (Anthropic). Phone numbers, e-mail addresses and long account numbers are removed from your question before it is sent to the AI provider.',
          'Authorities, where the law requires us to disclose information.',
        ],
      },
      {
        heading: 'How long we keep it',
        bullets: [
          'Group financial records are kept for as long as the group needs them for its books, and at least as long as Kenyan law requires for financial records.',
          'If you delete your account, your personal details are removed. Records you were part of stay in your groups’ books, with your identity anonymised, so each Chama’s accounts still balance.',
          'AI assistant conversations are deleted automatically after 30 days, and you can delete them sooner.',
          'Sign-in sessions on a device end after 30 days without use, or when you sign out.',
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          'Under the Data Protection Act you may ask to access the personal data we hold about you, have it corrected, object to or restrict certain processing, have it deleted where we are not required to keep it, and receive a copy in a portable format. You can correct your details and request account deletion in the app under Profile. For anything else, contact us using the details below.',
          'If you are not satisfied with our response, you may complain to the Office of the Data Protection Commissioner (ODPC), Kenya — www.odpc.go.ke.',
        ],
      },
      {
        heading: 'Cookies',
        paragraphs: [
          'The ChamaHub website uses only cookies that are strictly necessary to keep you signed in securely (a session cookie and a sign-in token). They cannot be read by other websites or by page scripts. We do not use analytics, advertising or tracking cookies, so there is no cookie banner.',
        ],
      },
      {
        heading: 'Security',
        paragraphs: [
          'Data is encrypted in transit. Money records are kept in an append-only ledger that cannot be silently edited or deleted, sensitive actions need a second officer’s approval, and every important action is logged. No system is perfectly secure; if we learn of a breach that affects you we will tell you and the ODPC as the law requires.',
        ],
      },
      { heading: 'Children', paragraphs: ['ChamaHub is for people aged 18 and over.'] },
      {
        heading: 'Changes to this policy',
        paragraphs: ['We will tell you in the app before material changes take effect. The date at the top shows the latest version.'],
      },
      {
        heading: 'Contact',
        bullets: [`${name}`, `Address: ${address}`, `E-mail: ${email}`, ...(o.odpcRegistration?.trim() ? [`ODPC registration: ${o.odpcRegistration.trim()}`] : [])],
      },
    ],
  };
}

export function termsOfUse(o: LegalOperator): LegalDocument {
  const name = orUnset(o.legalName, 'Company legal name');
  const email = orUnset(o.email, 'Support contact e-mail');
  const address = orUnset(o.address, 'Postal and physical address');
  return {
    title: 'Terms of Use',
    updated: LEGAL_UPDATED,
    draft: !isLegalConfigured(o),
    intro: `These terms are an agreement between you and ${name}, which operates ChamaHub. By creating an account or using ChamaHub you agree to them. If you do not agree, do not use ChamaHub.`,
    sections: [
      {
        heading: 'What ChamaHub is',
        paragraphs: [
          'ChamaHub is a record-keeping and coordination tool for Chamas (savings groups). It helps groups record contributions, reconcile payments, track loans and payouts, hold meetings and keep an audit trail.',
          'ChamaHub is not a bank, deposit-taker, lender or investment adviser, and does not hold your group’s money. Money stays in your group’s own M-Pesa, bank or cash arrangements. ChamaHub does not guarantee any savings, returns, payouts or loan approvals: payouts and loans depend on what members actually pay and on your group’s own decisions.',
        ],
      },
      {
        heading: 'Your account',
        bullets: [
          'You must be 18 or older and give accurate details. One account per person.',
          'Keep your password private. Never share your password, M-Pesa PIN, bank password or any one-time code with anyone — including officers, other members or anyone claiming to be ChamaHub.',
          'You are responsible for activity on your account. Tell us at once if you think it has been misused; you can sign out other devices under Profile › Security.',
        ],
      },
      {
        heading: 'Your Chama and its officers',
        bullets: [
          'Each group sets its own rules (contribution amounts, fines, loan policy, payout order) and chooses its officers. ChamaHub applies those rules as the group configures them but is not a party to agreements between members.',
          'Officers must record transactions honestly, confirm payments only after checking the money arrived, and use access only for their group duties. Completed money records cannot be edited or deleted; corrections are made by a reversing entry that stays on record.',
          'Members must report payments truthfully. A reported payment does not count until it is confirmed.',
          'Disputes between members or with officers are for the group to resolve. ChamaHub provides the records and audit trail to help.',
        ],
      },
      {
        heading: 'AI assistant',
        paragraphs: [
          'The optional AI assistant explains your group’s records and drafts messages. Figures come from ChamaHub’s records, but the assistant’s wording can be wrong. It is not financial, legal or tax advice, and it cannot change any record. Check important figures in your statements.',
        ],
      },
      {
        heading: 'Acceptable use',
        bullets: [
          'Do not use ChamaHub for fraud, money laundering, illegal lending, pyramid or Ponzi schemes, or any unlawful purpose.',
          'Do not try to access another group’s or person’s data, interfere with the service, or reverse-engineer it.',
          'Do not upload content that is unlawful, misleading or infringes someone else’s rights.',
        ],
      },
      {
        heading: 'Fees',
        paragraphs: ['If a group’s plan has a fee, it is shown before the group agrees to it. Mobile-money and bank charges are set by those providers.'],
      },
      {
        heading: 'Availability and changes',
        paragraphs: [
          'We work to keep ChamaHub available and its records backed up, but it may sometimes be unavailable for maintenance or reasons outside our control. We may change features; we will give notice in the app of changes that materially affect you.',
        ],
      },
      {
        heading: 'Suspension and closing your account',
        paragraphs: [
          'You can request account deletion at any time under Profile › Privacy. We may suspend an account that breaks these terms or puts other users at risk, and will explain why unless the law prevents us. Group financial records are kept as described in the Privacy Policy.',
        ],
      },
      {
        heading: 'Liability',
        paragraphs: [
          'To the extent the law allows, we are not liable for losses caused by a group’s decisions, by members or officers, by mobile-money or bank providers, or by information entered incorrectly. Nothing in these terms limits rights you have under the Consumer Protection Act, 2012 or other Kenyan law that cannot be excluded.',
        ],
      },
      { heading: 'Governing law', paragraphs: ['These terms are governed by the laws of Kenya. The courts of Kenya have jurisdiction over any dispute.'] },
      { heading: 'Contact', bullets: [`${name}`, `Address: ${address}`, `E-mail: ${email}`] },
    ],
  };
}
