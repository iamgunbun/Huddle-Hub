import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';
import { LeagueProvider } from './context/LeagueContext';
import Layout from './components/Layout';

// Public Pages
import Login from './pages/Login';
import Invite from './pages/Invite';
import Onboarding from './pages/Onboarding';

// Main App Pages
import Home from './pages/Home';
import Projections from './pages/Projections';
import Transactions from './pages/Transactions';
import Matchups from './pages/Matchups';
import Players from './pages/Players';

// Tools
import StartSit from './pages/StartSit';
import TradeGrader from './pages/TradeGrader';
import DraftGrader from './pages/DraftGrader';

// League Info & History
import Rosters from './pages/Rosters';
import AddLeague from './pages/AddLeague';
import Managers from './pages/Managers';
import Rivalry from './pages/Rivalry';
import Standings from './pages/Standings';
import Drafts from './pages/Drafts';
import Awards from './pages/Awards';
import Records from './pages/Records';
import Constitution from './pages/Constitution';
import Scoring from './pages/Scoring';
import UserSettings from './pages/UserSettings';

// Admin Pages
import AdminNotes from './pages/admin/AdminNotes';
import AdminFees from './pages/admin/AdminFees';
import AdminConstitution from './pages/admin/AdminConstitution';

const RequireOnboarding = ({ children }) => {
    const hasSeenOnboarding = localStorage.getItem('hasSeenOnboarding');
    if (!hasSeenOnboarding) return <Navigate to="/onboarding" replace />;
    return children;
};

function App() {
    
    // Initialize RevenueCat Native Bridge on Boot
    useEffect(() => {
        if (Capacitor.isNativePlatform()) {
            const initRevenueCat = async () => {
                try {
                    if (Capacitor.getPlatform() === 'android') {
                        await Purchases.configure({ apiKey: "goog_YOUR_ANDROID_REVENUECAT_KEY_HERE" });
                    } else if (Capacitor.getPlatform() === 'ios') {
                        await Purchases.configure({ apiKey: "appl_YOUR_IOS_REVENUECAT_KEY_HERE" });
                    }
                } catch (error) {
                    console.error("RevenueCat Configuration Error:", error);
                }
            };
            initRevenueCat();
        }
    }, []);

    return (
        <LeagueProvider>
            <Router>
                <Routes>
                    <Route path="/onboarding" element={<Onboarding />} />
                    <Route path="/login" element={<RequireOnboarding><Login /></RequireOnboarding>} />
                    <Route path="/invite/:league_id" element={<RequireOnboarding><Invite /></RequireOnboarding>} />
                    
                    <Route element={<Layout />}>
                        <Route path="/" element={<Home />} />
                        <Route path="/projections" element={<Projections />} />
                        <Route path="/transactions" element={<Transactions />} />
                        <Route path="/matchups" element={<Matchups />} />
                        <Route path="/players" element={<Players />} />
                        
                        {/* --- TOOLS --- */}
                        <Route path="/start-sit" element={<StartSit />} />
                        <Route path="/trade-analyzer" element={<TradeGrader />} />
                        <Route path="/draft-analyzer" element={<DraftGrader />} />
                        
                        <Route path="/rosters" element={<Rosters />} />
                        <Route path="/add-league" element={<AddLeague />} />
                        <Route path="/managers" element={<Managers />} />
                        <Route path="/rivalry" element={<Rivalry />} />
                        <Route path="/standings" element={<Standings />} />
                        <Route path="/drafts" element={<Drafts />} />
                        <Route path="/awards" element={<Awards />} />
                        <Route path="/records" element={<Records />} />
                        <Route path="/constitution" element={<Constitution />} />
                        <Route path="/scoring" element={<Scoring />} />
                        <Route path="/account" element={<UserSettings />} />
                        
                        <Route path="/admin/constitution" element={<AdminConstitution />} />
                        <Route path="/admin/notes" element={<AdminNotes />} />
                        <Route path="/admin/fees" element={<AdminFees />} />
                    </Route>
                </Routes>
            </Router>
        </LeagueProvider>
    );
}

export default App;