import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface TranslationCardProps {
  id: string;
  englishText: string;
  translatedText: string;
  language: string;
  onApprove: (id: string) => void;
  onDisapprove: (id: string, correction?: string) => void;
  onClearStatus: (id: string) => void;
  status?: 'approved' | 'disapproved' | null;
  correction?: string;
  isDarkMode?: boolean;
}

export function TranslationCard({
  id,
  englishText,
  translatedText,
  language,
  onApprove,
  onDisapprove,
  onClearStatus,
  status,
  correction,
  isDarkMode = false,
}: TranslationCardProps) {
  const [showCorrectionField, setShowCorrectionField] = useState(false);
  const [correctionText, setCorrectionText] = useState(correction || '');
  const correctionInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset state when translation changes
  useEffect(() => {
    setShowCorrectionField(false);
    setCorrectionText(correction || '');
  }, [id, correction]);

  useEffect(() => {
    if (showCorrectionField) {
      correctionInputRef.current?.focus();
    }
  }, [showCorrectionField]);

  const handleDisapproveClick = () => {
    if (status === 'disapproved') {
      // If already disapproved, toggle the correction field
      setShowCorrectionField(!showCorrectionField);
    } else {
      // Show correction field for first time disapproval
      setShowCorrectionField(true);
    }
  };

  const handleSubmitCorrection = () => {
    onDisapprove(id, correctionText);
    setShowCorrectionField(false);
  };

  const handleCancelCorrection = () => {
    setShowCorrectionField(false);
    setCorrectionText(correction || '');
    // Clear the disapproved status if there was no previous correction
    if (!correction) {
      onClearStatus(id);
    }
  };

  return (
    <div className={`rounded-lg shadow-md p-6 border ${
      isDarkMode 
        ? 'bg-[#1a2220] border-[#2f3a35]' 
        : 'bg-white border-[#C4D8B1]'
    }`}>
      <div className="space-y-4">
        {/* English Text Section */}
        <div>
          <p className={`text-sm mb-2 ${isDarkMode ? 'text-[#93a19a]' : 'text-[#808080]'}`}>Original (English)</p>
          <p className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{englishText}</p>
        </div>

        {/* Translation Section */}
        <div className={`pt-4 border-t ${isDarkMode ? 'border-[#2f3a35]' : 'border-[#C4D8B1]'}`}>
          <p className={`text-sm mb-2 ${isDarkMode ? 'text-[#93a19a]' : 'text-[#808080]'}`}>Translation ({language})</p>
          <p className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{translatedText}</p>
        </div>

        {/* Show existing correction if it exists */}
        {status === 'disapproved' && correction && !showCorrectionField && (
          <div className={`pt-4 border-t ${isDarkMode ? 'border-[#2f3a35]' : 'border-[#C4D8B1]'}`}>
            <p className={`text-sm mb-2 ${isDarkMode ? 'text-[#93a19a]' : 'text-[#808080]'}`}>Your Suggested Correction</p>
            <p className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{correction}</p>
          </div>
        )}

        {/* Correction Field */}
        {showCorrectionField && (
          <div className={`pt-4 border-t ${isDarkMode ? 'border-[#2f3a35]' : 'border-[#C4D8B1]'}`}>
            <label htmlFor={`correction-${id}`} className={`text-sm mb-2 block ${
              isDarkMode ? 'text-[#b7c2bb]' : 'text-[#556052]'
            }`}>
              Enter the correct translation:
            </label>
            <textarea
              ref={correctionInputRef}
              id={`correction-${id}`}
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#6A9266] resize-none ${
                isDarkMode 
                  ? 'bg-[#121917] border-[#3a4742] text-white placeholder-[#74827b]' 
                  : 'bg-white border-[#8BA295] text-gray-900'
              }`}
              rows={3}
              placeholder="Type the correct translation here..."
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleSubmitCorrection}
                className="px-4 py-2 bg-[#6A9266] text-white rounded-lg hover:bg-[#5d8259] transition-colors"
              >
                Submit Correction
              </button>
              <button
                onClick={handleCancelCorrection}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  isDarkMode 
                    ? 'bg-[#27322e] text-[#d5ddd8] hover:bg-[#313d38]' 
                    : 'bg-[#f3f3f3] text-[#556052] hover:bg-[#e2e2e2]'
                }`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {!showCorrectionField && (
          <div className="flex gap-3 pt-4">
            <button
              onClick={() => onApprove(id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-colors ${
                status === 'approved'
                  ? 'bg-[#6A9266] text-white'
                  : isDarkMode
                    ? 'bg-[#27322e] text-[#d5ddd8] hover:bg-[#6A9266] hover:text-white'
                  : 'bg-[#f3f3f3] text-[#556052] hover:bg-[#C4D8B1]/50 hover:text-[#335033]'
              }`}
            >
              <ThumbsUp className="w-5 h-5" />
              <span>Approve</span>
            </button>
            <button
              onClick={handleDisapproveClick}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-colors ${
                status === 'disapproved'
                  ? 'bg-[#A81524] text-white'
                  : isDarkMode
                    ? 'bg-[#27322e] text-[#d5ddd8] hover:bg-[#A81524] hover:text-white'
                  : 'bg-[#f3f3f3] text-[#556052] hover:bg-[#A81524]/10 hover:text-[#A81524]'
              }`}
            >
              <ThumbsDown className="w-5 h-5" />
              <span>Disapprove</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}