import { apiDelete, apiGet, apiPost, apiPut, extractData, type BackendResponse } from './client';
import type { AddressBookCreate, AddressBookEntry, AddressBookUpdate } from '../types';

export async function getAddressBook(params?: {
  chain_type?: string;
  btc_network?: string;
}): Promise<AddressBookEntry[]> {
  const query = new URLSearchParams();
  if (params?.chain_type) query.set('chain_type', params.chain_type);
  if (params?.btc_network) query.set('btc_network', params.btc_network);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await apiGet<BackendResponse<AddressBookEntry[]>>(`/address-book${suffix}`);
  return extractData(response);
}

export async function createAddressBook(payload: AddressBookCreate): Promise<AddressBookEntry> {
  const response = await apiPost<BackendResponse<AddressBookEntry>, AddressBookCreate>('/address-book', payload);
  return extractData(response);
}

export async function updateAddressBook(id: string, payload: AddressBookUpdate): Promise<AddressBookEntry> {
  const response = await apiPut<BackendResponse<AddressBookEntry>, AddressBookUpdate>(`/address-book/${id}`, payload);
  return extractData(response);
}

export async function deleteAddressBook(id: string): Promise<void> {
  await apiDelete(`/address-book/${id}`);
}
