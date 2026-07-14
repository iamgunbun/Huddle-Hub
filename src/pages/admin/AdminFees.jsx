import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../../context/LeagueContext';
import { supabase } from '../../supabaseClient';
import { getLeagueTeamManagers } from '../../utils/helper';
import styles from './AdminFees.module.css';

export default function AdminFees() {
    const { activeLeague, loadLeagueContext } = useLeague();
    const navigate = useNavigate();
    
    const [loading, setLoading] = useState(true);
    const [duesAmount, setDuesAmount] = useState('');
    const [duesData, setDuesData] = useState({}); 
    const [rostersList, setRostersList] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);

    useEffect(() => {
        if (activeLeague && !activeLeague.is_commissioner) {
            navigate('/');
            return;
        }
        
        const loadDuesData = async () => {
            if (!activeLeague) return;
            setLoading(true);
            try {
                const tmData = await getLeagueTeamManagers(activeLeague.sleeper_league_id);
                const currentYearRosters = tmData?.teamManagersMap[tmData.currentSeason] || {};
                
                const formattedRosters = Object.keys(currentYearRosters).map(rId => {
                    const roster = currentYearRosters[rId];
                    const managerId = roster.managers?.[0];
                    const handle = tmData.users?.[managerId]?.display_name || '';
                    return {
                        rosterId: rId,
                        name: roster.team?.name || `Team ${rId}`,
                        avatar: roster.team?.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp',
                        handle: handle
                    };
                });
                
                setRostersList(formattedRosters);
                setDuesAmount(activeLeague.dues_amount || '');
                
                const existing = activeLeague.dues_status || {};
                const initialized = {};
                formattedRosters.forEach(r => {
                    const data = existing[r.rosterId];
                    if (typeof data === 'boolean') {
                        initialized[r.rosterId] = { isPaid: data, amountPaid: data ? parseFloat(activeLeague.dues_amount) || 0 : 0 };
                    } else {
                        initialized[r.rosterId] = data || { isPaid: false, amountPaid: 0 };
                    }
                });
                setDuesData(initialized);

            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        
        loadDuesData();
    }, [activeLeague, navigate]);

    // Handle single input updates
    const updateDuesEntry = (rosterId, field, value) => {
        setDuesData(prev => ({
            ...prev,
            [rosterId]: {
                ...prev[rosterId],
                [field]: value
            }
        }));
    };

    // Auto-fill logic: Toggle status and sync the dollar amount automatically
    const togglePaidStatus = (rosterId, currentIsPaid) => {
        const newStatus = !currentIsPaid;
        const autoAmount = newStatus ? (parseFloat(duesAmount) || 0) : 0;
        
        setDuesData(prev => ({
            ...prev,
            [rosterId]: {
                isPaid: newStatus,
                amountPaid: autoAmount
            }
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('leagues')
                .update({ 
                    dues_amount: parseFloat(duesAmount) || 0,
                    dues_status: duesData
                })
                .eq('id', activeLeague.id);

            if (error) throw error;
            setSaveMessage({ type: 'success', text: 'Ledger updated successfully.' });
            
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) await loadLeagueContext(session.user.id, activeLeague.id);
        } catch (error) {
            setSaveMessage({ type: 'error', text: 'Failed to save updates.' });
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };

    if (loading || !activeLeague) return <div className={styles.loading}>Loading Ledger...</div>;

    const totalCollected = Object.values(duesData).reduce((sum, entry) => sum + (parseFloat(entry.amountPaid) || 0), 0);
    const totalExpected = rostersList.length * (parseFloat(duesAmount) || 0);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Admin Dashboard</h1>
                <h2 className={styles.subtitle}>Manage League Dues</h2>
            </div>

            <div className={styles.ledgerCard}>
                <div className={styles.cardHeader}><i className="material-icons">payments</i> Financial Ledger</div>
                
                <div className={styles.editorBody}>
                    <div className={styles.globalSettings}>
                        <div className={styles.inputGroup}>
                            <label>Full Fee Amount ($)</label>
                            <input type="number" className={styles.duesInput} value={duesAmount} onChange={(e) => setDuesAmount(e.target.value)} />
                        </div>
                        <div className={styles.potSummary}>
                            <div className={styles.potLabel}>Total Pot Collected</div>
                            <div className={styles.potValue}>${totalCollected.toFixed(2)} <span className={styles.potTarget}>/ ${totalExpected.toFixed(2)}</span></div>
                        </div>
                    </div>

                    <div className={styles.managerList}>
                        {rostersList.map(team => {
                            const entry = duesData[team.rosterId] || { isPaid: false, amountPaid: 0 };
                            return (
                                <div key={team.rosterId} className={`${styles.managerRow} ${entry.isPaid ? styles.paidRow : ''}`}>
                                    <div className={styles.teamInfo}>
                                        <img src={team.avatar} alt="Avatar" className={styles.avatar} />
                                        <div className={styles.nameStack}>
                                            <span className={styles.teamName}>{team.name}</span>
                                            <span className={styles.handle}>{team.handle}</span>
                                        </div>
                                    </div>
                                    
                                    <div className={styles.actionGroup}>
                                        <input 
                                            type="number" 
                                            className={styles.amountInput}
                                            value={entry.amountPaid}
                                            onChange={(e) => updateDuesEntry(team.rosterId, 'amountPaid', e.target.value)}
                                            placeholder="0.00"
                                        />
                                        <button 
                                            className={`${styles.statusToggle} ${entry.isPaid ? styles.paidBtn : styles.unpaidBtn}`}
                                            onClick={() => togglePaidStatus(team.rosterId, entry.isPaid)}
                                        >
                                            {entry.isPaid ? 'Fully Paid' : 'Pending'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className={styles.cardFooter}>
                    {saveMessage && <div className={styles.message}>{saveMessage.text}</div>}
                    <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving}>{isSaving ? 'Saving...' : 'Update Ledger'}</button>
                </div>
            </div>
        </div>
    );
}