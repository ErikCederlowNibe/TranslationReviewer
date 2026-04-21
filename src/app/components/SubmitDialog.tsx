import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface SubmitDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isSuccess: boolean;
  unreviewedCount?: number;
  isDarkMode?: boolean;
}

export function SubmitDialog({ isOpen, onClose, isSuccess, unreviewedCount = 0, isDarkMode = false }: SubmitDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      
      {/* Dialog */}
      <div className={`relative rounded-lg shadow-xl p-6 max-w-md w-full mx-4 ${
        isDarkMode ? 'bg-[#1a2220]' : 'bg-white'
      }`}>
        {isSuccess ? (
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <CheckCircle2 className="w-16 h-16 text-[#6A9266]" />
            </div>
            <h2 className={`text-2xl mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Submission Complete</h2>
            <p className={`mb-6 ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
              This batch is done. Your submission has been saved and you will be returned to the batches page.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-3 bg-[#6A9266] text-white rounded-lg hover:bg-[#5d8259] transition-colors"
            >
              Back to Batches
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <AlertCircle className="w-16 h-16 text-[#A81524]" />
            </div>
            <h2 className={`text-2xl mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Cannot Submit</h2>
            <p className={`mb-6 ${isDarkMode ? 'text-[#b7c2bb]' : 'text-[#808080]'}`}>
              You still have <span className="text-[#A81524]">{unreviewedCount}</span> unreviewed translation{unreviewedCount !== 1 ? 's' : ''}. 
              Please review all translations before submitting.
            </p>
            <button
              onClick={onClose}
              className="px-6 py-3 bg-[#6A9266] text-white rounded-lg hover:bg-[#5d8259] transition-colors"
            >
              Continue Reviewing
            </button>
          </div>
        )}
      </div>
    </div>
  );
}