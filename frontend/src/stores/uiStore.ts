import { create } from 'zustand';

interface UIState {
  isSidebarOpen: boolean;
  theme: 'light' | 'dark';

  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  theme: 'light',

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
  setTheme: (theme) => set({ theme }),
}));
