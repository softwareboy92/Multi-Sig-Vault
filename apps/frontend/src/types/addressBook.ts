export type AddressBookChainType = 'BTC' | 'EVM';

export interface AddressBookEntry {
  id: string;
  name: string;
  address: string;
  chain_type: AddressBookChainType;
  btc_network?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AddressBookCreate {
  name: string;
  address: string;
  chain_type: AddressBookChainType;
  btc_network?: string | null;
  note?: string | null;
}

export interface AddressBookUpdate extends AddressBookCreate {}
