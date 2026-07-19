import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { LeagueProvider } from './context/LeagueContext';
import Layout from './components/Layout';

// Public Pages
import Login from './pages/Login';
import Invite from './pages/Invite';

// Main App Pages
import Home from './pages/Home';
import Projections from './pages/Projections';
import Transactions from './pages/Transactions';
import Matchups from './pages/Matchups';
import Players from './pages/Players'; // <-- NEW IMPORT

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

function App() {
    return (
        <LeagueProvider>
            <Router>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/invite/:league_id" element={<Invite />} />
                    
                    <Route element={<Layout />}>
                        <Route path="/" element={<Home />} />
                        <Route path="/projections" element={<Projections />} />
                        <Route path="/transactions" element={<Transactions />} />
                        <Route path="/matchups" element={<Matchups />} />
                        <Route path="/players" element={<Players />} /> {/* <-- NEW ROUTE */}
                        
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