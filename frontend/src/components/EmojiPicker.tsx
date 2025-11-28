import React, { useRef, useEffect } from 'react';
import EmojiPickerReact, { EmojiClickData, Theme } from 'emoji-picker-react';

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  onClose: () => void;
  position?: 'top' | 'bottom';
}

export default function EmojiPicker({ onEmojiSelect, onClose, position = 'top' }: EmojiPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onEmojiSelect(emojiData.emoji);
  };

  return (
    <div
      ref={pickerRef}
      className={`absolute z-50 ${position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0`}
    >
      <EmojiPickerReact
        onEmojiClick={handleEmojiClick}
        theme={Theme.DARK}
        width={320}
        height={400}
        searchPlaceHolder="Search emoji..."
        previewConfig={{
          showPreview: false
        }}
        skinTonesDisabled
        lazyLoadEmojis
      />
    </div>
  );
}
