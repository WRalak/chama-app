import { pushText } from './notifications.service';

describe('push notification text', () => {
  it('keeps amounts and security details off the lock screen', () => {
    for (const type of ['PAYMENT_CONFIRMED', 'LOAN_APPROVED', 'PAYOUT_SENT', 'REPAYMENT_DUE', 'SECURITY', 'DESTINATION_CHANGED']) {
      const t = pushText({ type, title: 'KES 15,000 received', body: 'Jane paid KES 15,000 to 0712345678 ref QJK12345XY' });
      expect(JSON.stringify(t)).not.toMatch(/KES|15,000|0712|QJK|Jane/);
    }
  });
  it('leaves non-financial notices as written', () => {
    expect(pushText({ type: 'MEETING_REMINDER', title: 'Meeting tomorrow', body: 'At the hall, 2pm' })).toEqual({ title: 'Meeting tomorrow', body: 'At the hall, 2pm' });
  });
});
