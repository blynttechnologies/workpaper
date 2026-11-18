'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AppSidebar } from './AppSidebar';
import { AppHeader } from './AppHeader';
import { BackToTopBot } from './BackToTopBot';
import { AskHost } from '@/components/ui/ask';
import { useEngagementTimer } from './useEngagementTimer';

interface DashboardShellProps {
  children: React.ReactNode;
}

export const DashboardShell: React.FC<DashboardShellProps> = ({ children }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Timed here, once, because the sidebar is mounted twice (desktop and mobile drawer)
  const match = usePathname()?.match(/\/engagements\/([^/]+)/);
  const timer = useEngagementTimer(match && match[1] !== 'new' ? match[1] : null);

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F5F8FD] text-[#122654]">
      {/* Sidebar for Desktop */}
      <div className="hidden lg:block shrink-0 w-[232px] bg-[#0B1A3B] border-r border-[#122654]">
        <div className="sticky top-0 h-screen overflow-y-auto dark-sidebar-scroll">
          <AppSidebar timerSeconds={timer.seconds} timerPaused={timer.paused} />
        </div>
      </div>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="lg:hidden fixed inset-0 z-50 bg-[#0B1A3B]/50 backdrop-blur-xs flex"
        >
          <div className="w-[232px] bg-[#0B1A3B] h-full shadow-2xl flex flex-col overflow-y-auto dark-sidebar-scroll">
            <AppSidebar timerSeconds={timer.seconds} timerPaused={timer.paused} onMobileClose={() => setMobileMenuOpen(false)} />
          </div>
          <div
            className="flex-1"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
          />
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0">
        <AppHeader onMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 p-4 md:p-6 lg:p-8 max-w-[1600px] w-full mx-auto outline-none"
        >
          {children}
        </main>
      </div>
      <BackToTopBot />
      <AskHost />
    </div>
  );
};
