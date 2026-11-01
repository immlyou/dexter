interface HeaderProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function Header({ isSidebarOpen, onToggleSidebar }: HeaderProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {!isSidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Open sidebar"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          )}
          <h2 className="text-lg font-semibold text-gray-800">
            Dexter AI
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Model selector will go here */}
          <div className="text-sm text-gray-600">
            GPT-4
          </div>
        </div>
      </div>
    </div>
  );
}
