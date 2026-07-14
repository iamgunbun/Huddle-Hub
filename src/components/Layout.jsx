import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import ChatDrawer from './ChatDrawer';
import { useLeague } from '../context/LeagueContext';

export default function Layout() {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { activeLeague } = useLeague();

    return (
        <div className="app-wrapper">
            <Header 
                toggleSidebar={() => setSidebarOpen(true)} 
                leagueName={activeLeague?.league_name} 
                avatar={activeLeague?.avatar} 
            />
            <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            
            {/* The Chat Component now runs independently */}
            <ChatDrawer />
            
            <main>
                <Outlet />
            </main>
        </div>
    );
}