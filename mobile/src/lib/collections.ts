import { useQuery } from '@tanstack/react-query';
import type { PaymentDestinationRow, PaymentHistory } from '@chamahub/shared';
import { api } from './api';
import type { PickedFile } from './files';

export const useDestinations = (groupId: string) => useQuery({ queryKey: ['destinations', groupId], queryFn: () => api<PaymentDestinationRow[]>(`groups/${groupId}/payment-destinations`), enabled: !!groupId });
export const usePaymentHistory = (groupId: string, paymentId: string) => useQuery({ queryKey: ['payment-history', paymentId], queryFn: () => api<PaymentHistory>(`groups/${groupId}/payments/${paymentId}/history`) });

export const uploadEvidence = (groupId: string, paymentId: string, f: PickedFile, note?: string) =>
  api<{ id: string; reusedOnAnotherPayment: boolean }>(`groups/${groupId}/payments/${paymentId}/evidence`, { body: { fileName: f.fileName, mimeType: f.mimeType, dataBase64: f.data, note } });
