'use client';

import React from 'react';
import { SanadTab } from './SidebarSanad';
import { AppState } from '@/lib/storage';
import { Home, Users, ClipboardList, BookOpen, Calendar } from 'lucide-react';

interface MobileNavigationProps {
  currentTab: SanadTab;
  onSelectTab: (tab: SanadTab) => void;
  onOpenMobileMenu: () => void;
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

interface NavItem {
  tab: SanadTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { tab: 'dashboard', label: 'الرئيسية', icon: Home },
  { tab: 'classes', label: 'الأقسام', icon: Users },
  { tab: 'grades', label: 'النقاط', icon: ClipboardList },
  { tab: 'prep', label: 'الدروس', icon: BookOpen },
  { tab: 'timetable', label: 'الجدول', icon: Calendar },
];

export const MobileNavigation: React.FC<MobileNavigationProps> = ({
  currentTab,
  onSelectTab,
}) => {
  return (
    <nav
      aria-label="شريط التنقل السفلي للهاتف" className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-[var(--bg-surface)] border-t border-[var(--border-default)] pb-[env(safe-area-inset-bottom)]" >
      <div className="max-w-md mx-auto flex items-center justify-around px-1 py-1">
        {navItems.map((item) => {
          const isActive = currentTab === item.tab;
          const Icon = item.icon;

          return (
            <button
              key={item.tab}
              onClick={() => onSelectTab(item.tab)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center min-h-[48px] py-1 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${
                isActive ? 'text-[var(--primary)]' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]' }`}
            >
              <div className="flex flex-col items-center justify-center">
                <Icon className="w-[22px] h-[22px]" />
                <span
                  className={`w-1 h-1 rounded-full mt-0.5 transition-colors ${
                    isActive ? 'bg-[var(--primary)]' : 'bg-transparent' }`}
                />
              </div>
              <span className="text-[10px] font-medium mt-1 leading-none">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
