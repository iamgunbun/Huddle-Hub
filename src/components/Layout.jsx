import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import ChatDrawer from './ChatDrawer';
import MobileTopNav from './MobileTopNav';
import { useLeague } from '../context/LeagueContext';

export default function Layout() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { activeLeague } = useLeague();
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1100);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 1100);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <div className="app-wrapper" style={{ overflowX: 'hidden', width: '100%' }}>
            <MobileTopNav toggleSidebar={() => setSidebarOpen(true)} activeLeague={activeLeague} />
            
            <div className="desktopNavOnly" style={{ display: isMobile ? 'none' : 'block' }}>
                <Header 
                    toggleSidebar={() => setSidebarOpen(true)} 
                    leagueName={activeLeague?.league_name} 
                    avatar={activeLeague?.avatar} 
                />
            </div>

            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            
            <ChatDrawer />
            
            <main className="layout-main" style={{ 
                paddingTop: isMobile ? '85px' : '0', 
                boxSizing: 'border-box', 
                overflowX: 'hidden', 
                width: '100%', 
                minHeight: '100vh' 
            }}>
                <Outlet />
            </main>
        </div>
    );
}