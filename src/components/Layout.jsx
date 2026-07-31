import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import ChatDrawer from './ChatDrawer';
import MobileTopNav from './MobileTopNav';
import MobileBottomNav from './MobileBottomNav';
import PremiumModal from './PremiumModal';
import { useLeague } from '../context/LeagueContext';

export default function Layout() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(false); 
    const { activeLeague, showPremiumModal, setShowPremiumModal } = useLeague();
    const [isMobile, setIsMobile] = useState(window.innerWidth <= 1100);

    const [touchStart, setTouchStart] = useState(null);
    const [touchEnd, setTouchEnd] = useState(null);
    const minSwipeDistance = 75;

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 1100);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const onTouchStart = (e) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    };

    const onTouchMove = (e) => {
        setTouchEnd(e.targetTouches[0].clientX);
    };

    const onTouchEndHandler = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;

        if (isLeftSwipe) {
            if (sidebarOpen) setSidebarOpen(false);
            else setChatOpen(true);
        }
        if (isRightSwipe) {
            if (chatOpen) setChatOpen(false);
            else setSidebarOpen(true);
        }
    };

    return (
        <div 
            className="app-wrapper" 
            style={{ overflowX: 'hidden', width: '100%' }}
            onTouchStart={onTouchStart} 
            onTouchMove={onTouchMove} 
            onTouchEnd={onTouchEndHandler}
        >
            <MobileTopNav toggleSidebar={() => setSidebarOpen(true)} activeLeague={activeLeague} />
            
            <div className="desktopNavOnly" style={{ display: isMobile ? 'none' : 'block' }}>
                <Header toggleSidebar={() => setSidebarOpen(true)} leagueName={activeLeague?.league_name} avatar={activeLeague?.avatar} />
            </div>

            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <ChatDrawer isOpen={chatOpen} onClose={() => setChatOpen(false)} />
            
            {showPremiumModal && <PremiumModal onClose={() => setShowPremiumModal(false)} />}
            
            <main className="layout-main" style={{ paddingTop: '0', paddingBottom: isMobile ? '130px' : '0', boxSizing: 'border-box', overflowX: 'hidden', width: '100%', minHeight: '100vh' }}>
                <Outlet />
            </main>

            {isMobile && <MobileBottomNav />}
        </div>
    );
}