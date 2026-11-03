// Contrat AuthStore sur le FAKE (test:unit). Le même contrat tourne sur PostgreSQL en test:int.
import { authStoreContract } from './auth-store-contract.js';
import { FakeAuthStore } from './fake-auth-store.js';

authStoreContract('FAKE', async () => ({ store: new FakeAuthStore(), release: async () => {} }));
