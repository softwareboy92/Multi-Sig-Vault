import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface UserState {
  user: User | null;
  setUser: (user: User | null) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      user: { id: 'local', username: 'User' },
      setUser: (user) => set({ user }),
    }),
    {
      name: 'user-storage',
    }
  )
);
