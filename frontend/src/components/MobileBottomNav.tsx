import React from 'react';
import { MessageSquare, Users, Plus, Settings, Radio } from 'lucide-react';

export type MobileTab = 'messages' | 'contacts' | 'new' | 'mesh' | 'settings';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  unreadCount?: number;
}

export default function MobileBottomNav({ activeTab, onTabChange, unreadCount = 0 }: MobileBottomNavProps) {
  const tabs: { id: MobileTab; icon: React.ReactNode; label: string }[] = [
    { id: 'messages', icon: <MessageSquare size={22} />, label: 'Chats' },
    { id: 'contacts', icon: <Users size={22} />, label: 'Contacts' },
    { id: 'new', icon: <Plus size={24} />, label: 'New' },
    { id: 'mesh', icon: <Radio size={22} />, label: 'Mesh' },
    { id: 'settings', icon: <Settings size={22} />, label: 'Settings' },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-midnight-light border-t border-midnight z-40 pb-safe">
      <div className="flex items-center justify-around h-16">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isNewButton = tab.id === 'new';
          
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                flex flex-col items-center justify-center gap-0.5 flex-1 h-full
                transition-all duration-200 relative
                ${isNewButton 
                  ? '' 
                  : isActive 
                    ? 'text-primary-400' 
                    : 'text-secondary active:text-white'
                }
              `}
            >
              {isNewButton ? (
                // Special styling for New/Plus button
                <div className="w-12 h-12 -mt-6 rounded-full bg-gradient-to-r from-primary-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-primary-500/30 active:scale-95 transition-transform">
                  {tab.icon}
                </div>
              ) : (
                <>
                  <div className="relative">
                    {tab.icon}
                    {/* Unread badge for messages */}
                    {tab.id === 'messages' && unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-danger-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </div>
                  <span className={`text-[10px] font-medium ${isActive ? 'text-primary-400' : 'text-muted'}`}>
                    {tab.label}
                  </span>
                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary-500 rounded-full" />
                  )}
                </>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
