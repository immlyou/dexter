import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useUIStore.setState({ isSidebarOpen: true });
  });

  describe('Initial State', () => {
    it('should have sidebar open by default', () => {
      const state = useUIStore.getState();
      expect(state.isSidebarOpen).toBe(true);
    });
  });

  describe('toggleSidebar', () => {
    it('should toggle sidebar from open to closed', () => {
      const { toggleSidebar } = useUIStore.getState();

      expect(useUIStore.getState().isSidebarOpen).toBe(true);

      toggleSidebar();

      expect(useUIStore.getState().isSidebarOpen).toBe(false);
    });

    it('should toggle sidebar from closed to open', () => {
      const { toggleSidebar } = useUIStore.getState();

      // Set to closed first
      useUIStore.setState({ isSidebarOpen: false });
      expect(useUIStore.getState().isSidebarOpen).toBe(false);

      toggleSidebar();

      expect(useUIStore.getState().isSidebarOpen).toBe(true);
    });

    it('should toggle multiple times correctly', () => {
      const { toggleSidebar } = useUIStore.getState();

      expect(useUIStore.getState().isSidebarOpen).toBe(true);

      toggleSidebar(); // false
      expect(useUIStore.getState().isSidebarOpen).toBe(false);

      toggleSidebar(); // true
      expect(useUIStore.getState().isSidebarOpen).toBe(true);

      toggleSidebar(); // false
      expect(useUIStore.getState().isSidebarOpen).toBe(false);
    });
  });

  describe('State Persistence', () => {
    it('should maintain state after multiple operations', () => {
      const { toggleSidebar } = useUIStore.getState();

      // Perform multiple operations
      toggleSidebar();
      toggleSidebar();
      toggleSidebar();

      // State should be consistent
      const state = useUIStore.getState();
      expect(typeof state.isSidebarOpen).toBe('boolean');
    });
  });

  describe('Direct State Update', () => {
    it('should allow direct state updates', () => {
      useUIStore.setState({ isSidebarOpen: false });
      expect(useUIStore.getState().isSidebarOpen).toBe(false);

      useUIStore.setState({ isSidebarOpen: true });
      expect(useUIStore.getState().isSidebarOpen).toBe(true);
    });
  });
});
