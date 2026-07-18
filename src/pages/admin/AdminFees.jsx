import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../../context/LeagueContext';
import { supabase } from '../../supabaseClient';
import { getLeagueTeamManagers, loadPlayers } from '../../utils/helper';
import styles from './AdminFees.module.css';

export default function AdminFees() {
    const { activeLeague, loadLeagueContext } = useLeague();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    
    // Config State
    const [duesAmount, setDuesAmount] = useState(100);
    const [enableTxnFees, setEnableTxnFees] = useState(false);
    const [txnFeeAmount, setTxnFeeAmount] = useState(1);
    const [excludeDefs, setExcludeDefs] = useState(false);
    
    // Raw Data State 
    const [rawTxns, setRawTxns] = useState([]);
    const [rawRosters, setRawRosters] = useState({});
    const [rawUsers, setRawUsers] = useState({});
    const [playersMap, setPlayersMap] = useState({});
    
    const [managersList, setManagersList] = useState([]);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);

    useEffect(() => {
        if (activeLeague && !activeLeague.is_commissioner) {
            navigate('/');
            return;
        }

        const loadInitialData = async () => {
            if (!activeLeague?.sleeper_league_id) return;
            setLoading(true);
            try {
                // 1. Fetch DB configs and the new JSON financial ledger
                const { data: leagueConfigs } = await supabase
                    .from('leagues')
                    .select('dues_amount, enable_txn_fees, txn_fee_amount, exclude_defenses_from_fees, ledger_season, financial_ledger')
                    .eq('id', activeLeague.id)
                    .maybeSingle();

                if (leagueConfigs) {
                    setDuesAmount(leagueConfigs.dues_amount ?? 100);
                    setEnableTxnFees(leagueConfigs.enable_txn_fees ?? false);
                    setTxnFeeAmount(leagueConfigs.txn_fee_amount ?? 1);
                    setExcludeDefs(leagueConfigs.exclude_defenses_from_fees ?? false);
                }

                // 2. Fetch Sleeper Data
                const [tmData, pData] = await Promise.all([
                    getLeagueTeamManagers(activeLeague.sleeper_league_id),
                    loadPlayers()
                ]);

                const pMap = pData?.players || {};
                const currentSeason = tmData.currentSeason;
                const activeRosters = tmData.teamManagersMap[currentSeason] || {};
                
                setPlayersMap(pMap);
                setRawRosters(activeRosters);
                setRawUsers(tmData.users || {});

                // 3. AUTO-RESET CHECK: If a new season has started, wipe payments in the JSON ledger to {}
                let activeLedger = leagueConfigs?.financial_ledger || {};
                
                if (leagueConfigs?.ledger_season && leagueConfigs.ledger_season !== currentSeason.toString()) {
                    activeLedger = {}; // Reset the ledger object
                    await supabase.from('leagues').update({ 
                        ledger_season: currentSeason.toString(),
                        financial_ledger: activeLedger
                    }).eq('id', activeLeague.id);
                } else if (!leagueConfigs?.ledger_season) {
                    await supabase.from('leagues').update({ ledger_season: currentSeason.toString() }).eq('id', activeLeague.id);
                }

                // 4. Fetch Transactions ONCE
                let allTxns = [];
                for (let i = 0; i <= 18; i++) {
                    const res = await fetch(`https://api.sleeper.app/v1/league/${activeLeague.sleeper_league_id}/transactions/${i}`);
                    if (res.ok) {
                        const data = await res.json();
                        allTxns = [...allTxns, ...data];
                    }
                }
                const completedTxns = allTxns.filter(t => t.status === 'complete');
                setRawTxns(completedTxns);

                // 5. Initial Map Generation using the activeLedger JSON object
                buildManagersList(activeRosters, completedTxns, pMap, tmData.users, activeLedger, leagueConfigs?.exclude_defenses_from_fees ?? false);

            } catch (err) {
                console.error("Failed to gather financial matrix details:", err);
            } finally {
                setLoading(false);
            }
        };

        loadInitialData();
    }, [activeLeague, navigate]);

    // The builder function that calculates math locally
    const buildManagersList = (rosters, txns, pMap, users, ledger, excludeDefensesActive) => {
        const formattedManagers = Object.entries(rosters).map(([rosterId, rData]) => {
            const primaryManagerId = rData.managers?.[0];
            const sleeperUser = users[primaryManagerId] || {};
            const teamName = rData.team.name;
            const rIdInt = parseInt(rosterId);

            let txnCounts = 0;
            txns.forEach(txn => {
                if (txn.type === 'trade') {
                    if (txn.roster_ids && txn.roster_ids.includes(rIdInt)) {
                        txnCounts++;
                    }
                } else if (txn.type === 'waiver' || txn.type === 'free_agent') {
                    if (txn.adds) {
                        Object.entries(txn.adds).forEach(([pId, rId]) => {
                            if (rId.toString() === rosterId.toString()) {
                                const isDef = pMap[pId]?.pos === 'DEF';
                                if (!excludeDefensesActive || !isDef) {
                                    txnCounts++;
                                }
                            }
                        });
                    }
                }
            });

            return {
                rosterId,
                teamName,
                avatar: rData.team.avatar,
                username: sleeperUser.display_name || 'Unknown',
                txnCounts,
                // Read from the JSON ledger directly using the Roster ID
                paidAmount: ledger[rosterId] || 0
            };
        });

        setManagersList(formattedManagers);
    };

    // Re-calculate math instantly when the exclude toggle changes
    useEffect(() => {
        if (!loading && Object.keys(rawRosters).length > 0) {
            // Re-build the temporary ledger from state to maintain input changes
            const currentLedger = {};
            managersList.forEach(m => currentLedger[m.rosterId] = m.paidAmount);
            buildManagersList(rawRosters, rawTxns, playersMap, rawUsers, currentLedger, excludeDefs);
        }
    }, [excludeDefs]);

    const handlePaidChange = (rosterId, val) => {
        setManagersList(prev => prev.map(m => 
            m.rosterId === rosterId ? { ...m, paidAmount: parseFloat(val) || 0 } : m
        ));
    };

    const handleManualReset = async () => {
        if (!window.confirm("Are you sure you want to reset all paid amounts to $0? This cannot be undone.")) return;
        setIsSaving(true);
        try {
            await supabase.from('leagues').update({ financial_ledger: {} }).eq('id', activeLeague.id);
            setManagersList(prev => prev.map(m => ({ ...m, paidAmount: 0 })));
            setSaveMessage({ type: 'success', text: 'All payments reset to $0.' });
        } catch (e) {
            setSaveMessage({ type: 'error', text: 'Failed to reset payments.' });
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };

    const handleSaveBylaws = async () => {
        setIsSaving(true);
        setSaveMessage(null);
        try {
            // Compile the array back into a single JSON ledger object
            const newLedger = {};
            managersList.forEach(mgr => {
                if (mgr.paidAmount > 0) {
                    newLedger[mgr.rosterId] = mgr.paidAmount;
                }
            });

            // Run exactly ONE database update. Flawless execution.
            const { error: leagueErr } = await supabase
                .from('leagues')
                .update({
                    dues_amount: duesAmount,
                    enable_txn_fees: enableTxnFees,
                    txn_fee_amount: txnFeeAmount,
                    exclude_defenses_from_fees: excludeDefs,
                    financial_ledger: newLedger
                })
                .eq('id', activeLeague.id);

            if (leagueErr) throw leagueErr;

            setSaveMessage({ type: 'success', text: 'Financial framework saved successfully.' });
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                await loadLeagueContext(session.user.id, activeLeague.id);
            }
        } catch (err) {
            setSaveMessage({ type: 'error', text: 'Error saving ledger. Ensure you are the league commissioner.' });
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };

    if (loading) return <div className={styles.loading}>Accessing Financial Ledgers...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Admin Dashboard</h1>
                <h2 className={styles.subtitle}>Manage League Dues & Fees</h2>
            </div>

            <div className={styles.configGrid}>
                <div className={styles.configCard}>
                    <label className={styles.fieldLabel}>Base Buy-In Dues ($)</label>
                    <input 
                        type="number" 
                        className={styles.numInput} 
                        value={duesAmount} 
                        onChange={(e) => setDuesAmount(parseInt(e.target.value) || 0)} 
                    />
                </div>
                
                <div className={styles.configCard}>
                    <label className={styles.checkboxLabel}>
                        <input 
                            type="checkbox" 
                            checked={enableTxnFees} 
                            onChange={(e) => setEnableTxnFees(e.target.checked)} 
                        />
                        <span className={styles.customCheck}></span>
                        Enable Transaction Fees
                    </label>
                    
                    {enableTxnFees && (
                        <div className={styles.feeSubPanel} style={{ marginTop: '15px' }}>
                            <label className={styles.fieldLabel} style={{ fontSize: '0.75em' }}>Cost Per Add/Trade ($)</label>
                            <input 
                                type="number" 
                                step="0.25"
                                className={styles.numInput} 
                                value={txnFeeAmount} 
                                onChange={(e) => setTxnFeeAmount(parseFloat(e.target.value) || 0)} 
                            />
                            
                            <label className={styles.checkboxLabel} style={{ marginTop: '15px', fontSize: '0.85em' }}>
                                <input 
                                    type="checkbox" 
                                    checked={excludeDefs} 
                                    onChange={(e) => setExcludeDefs(e.target.checked)} 
                                />
                                <span className={styles.customCheck}></span>
                                Exclude Defenses (DEF)
                            </label>
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.ledgerCard}>
                <div className={styles.cardHeader}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <i className="material-icons">payments</i> Franchise Accounts Ledger
                    </div>
                    <button 
                        onClick={handleManualReset}
                        style={{ background: 'transparent', color: '#ef4444', border: '1px solid #ef4444', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8em', fontWeight: 'bold' }}
                    >
                        Reset All To $0
                    </button>
                </div>
                
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={styles.textLeft}>Manager</th>
                                <th>Moves</th>
                                {enableTxnFees && <th>Txn Fees</th>}
                                <th>Total Owed</th>
                                <th>Amount Paid ($)</th>
                                <th>Balance Due</th>
                            </tr>
                        </thead>
                        <tbody>
                            {managersList.map(mgr => {
                                const calculatedTxnTotal = enableTxnFees ? (mgr.txnCounts * txnFeeAmount) : 0;
                                const grossOwed = duesAmount + calculatedTxnTotal;
                                const netBalance = grossOwed - mgr.paidAmount;

                                return (
                                    <tr key={mgr.rosterId} className={styles.row}>
                                        <td>
                                            <div className={styles.managerCell}>
                                                <img src={mgr.avatar} className={styles.tableAvatar} alt="team" onError={(e) => e.target.src = 'https://sleepercdn.com/images/v2/icons/league_default.webp'} />
                                                <div className={styles.identityStack}>
                                                    <span className={styles.teamName}>{mgr.teamName}</span>
                                                    <span className={styles.handle}>@{mgr.username}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className={styles.textCenter}>{mgr.txnCounts}</td>
                                        {enableTxnFees && <td className={styles.textCenter} style={{color: '#ffaa00'}}>${calculatedTxnTotal.toFixed(2)}</td>}
                                        <td className={styles.textCenter} style={{fontWeight: '700'}}>${grossOwed.toFixed(2)}</td>
                                        <td className={styles.textCenter}>
                                            <input 
                                                type="number" 
                                                className={styles.tableInput} 
                                                value={mgr.paidAmount} 
                                                onChange={(e) => handlePaidChange(mgr.rosterId, e.target.value)} 
                                            />
                                        </td>
                                        <td className={styles.textCenter} style={{ color: netBalance > 0 ? '#ff2a6d' : '#00ceb8', fontWeight: '800' }}>
                                            ${netBalance.toFixed(2)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* MOBILE VIEW - CLEANED UP AND OPTIMIZED */}
                <div className={styles.mobileLedgerList}>
                    {managersList.map(mgr => {
                        const calculatedTxnTotal = enableTxnFees ? (mgr.txnCounts * txnFeeAmount) : 0;
                        const grossOwed = duesAmount + calculatedTxnTotal;
                        const netBalance = grossOwed - mgr.paidAmount;

                        return (
                            <div key={`mob-${mgr.rosterId}`} className={styles.mobileRecordCard}>
                                <div className={styles.mobileCardTop}>
                                    <img src={mgr.avatar} className={styles.tableAvatar} alt="team" onError={(e) => e.target.src = 'https://sleepercdn.com/images/v2/icons/league_default.webp'} />
                                    <div className={styles.identityStack}>
                                        <span className={styles.teamName}>{mgr.teamName}</span>
                                        <span className={styles.handle}>@{mgr.username}</span>
                                    </div>
                                </div>
                                <div className={styles.mobileMetricsRows}>
                                    <div className={styles.mobileMetricRow}>
                                        <span className={styles.mobileLabel}>Base Buy-In:</span>
                                        <span className={styles.mobileValue}>${duesAmount.toFixed(2)}</span>
                                    </div>
                                    <div className={styles.mobileMetricRow}>
                                        <span className={styles.mobileLabel}>Txn Fees ({mgr.txnCounts}):</span>
                                        <span className={styles.mobileValue} style={{ color: enableTxnFees ? '#ffaa00' : '#64748b' }}>
                                            ${calculatedTxnTotal.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className={styles.mobileTotalRow}>
                                        <span className={styles.mobileLabel}>Gross Owed:</span>
                                        <span className={styles.mobileValue}>${grossOwed.toFixed(2)}</span>
                                    </div>
                                    <div className={styles.mobileInputRow}>
                                        <label>Amount Collected ($)</label>
                                        <input 
                                            type="number" 
                                            className={styles.mobileInput} 
                                            value={mgr.paidAmount} 
                                            onChange={(e) => handlePaidChange(mgr.rosterId, e.target.value)} 
                                        />
                                    </div>
                                    <div className={styles.mobileBalanceRow} style={{ borderColor: netBalance > 0 ? 'rgba(255, 42, 109, 0.3)' : 'rgba(0, 206, 184, 0.3)' }}>
                                        <span className={styles.mobileLabel}>Balance Due:</span>
                                        <span style={{ color: netBalance > 0 ? '#ff2a6d' : '#00ceb8', fontWeight: '900', fontSize: '1.2em' }}>
                                            ${netBalance.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className={styles.cardFooter}>
                    {saveMessage && (
                        <div className={`${styles.message} ${saveMessage.type === 'success' ? styles.success : styles.error}`}>
                            {saveMessage.text}
                        </div>
                    )}
                    <button 
                        className={styles.saveBtn} 
                        onClick={handleSaveBylaws} 
                        disabled={isSaving}
                    >
                        {isSaving ? 'Processing Records...' : 'Save Financial Ledger'}
                    </button>
                </div>
            </div>
        </div>
    );
}