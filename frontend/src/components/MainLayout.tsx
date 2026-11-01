import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSessions } from '../hooks/useSessions';
import Sidebar from './Sidebar/Sidebar';
import ChatInterface from './Chat/ChatInterface';

export default function MainLayout() {
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const currentSession = useSessionStore((state) => state.currentSession);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);

  // Fetch sessions
  const { sessions, isLoading } = useSessions({
    sort: 'updatedAt',
    order: 'desc',
  });

  // Auto-select the first session if no session is selected
  useEffect(() => {
    if (!isLoading && !currentSession && sessions.length > 0) {
      setCurrentSession(sessions[0]);
    }
  }, [sessions, isLoading, currentSession, setCurrentSession]);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div
        className={`
          transition-all duration-300 ease-in-out
          ${isSidebarOpen ? 'w-64' : 'w-0'}
          overflow-hidden
        `}
      >
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <ChatInterface />
      </div>
    </div>
  );
}
