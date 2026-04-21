interface ProgressBarProps {
  current: number;
  total: number;
  approved: number;
  disapproved: number;
  isDarkMode?: boolean;
}

export function ProgressBar({ current, total, approved, disapproved, isDarkMode = false }: ProgressBarProps) {
  const reviewed = approved + disapproved;
  const percentage = total > 0 ? (reviewed / total) * 100 : 0;

  return (
    <div className={`rounded-lg shadow-md p-6 border ${
      isDarkMode 
        ? 'bg-[#1a2220] border-[#2f3a35]' 
        : 'bg-white border-[#C4D8B1]'
    }`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className={`text-xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Review Progress</h2>
          <span className={`text-sm ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
            {reviewed} of {total} reviewed
          </span>
        </div>

        {/* Progress Bar */}
        <div className={`w-full rounded-full h-3 overflow-hidden ${
          isDarkMode ? 'bg-[#2c3833]' : 'bg-[#e2e2e2]'
        }`}>
          <div
            className="bg-[#6A9266] h-full transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Stats */}
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#6A9266]" />
            <span className={`text-sm ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}>
              Approved: <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{approved}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#A81524]" />
            <span className={`text-sm ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'}`}>
              Disapproved: <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{disapproved}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}