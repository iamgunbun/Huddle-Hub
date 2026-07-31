import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useLeague } from '../../context/LeagueContext';
import { getLeagueTeamManagers } from '../../utils/helper';
import BackButton from '../../components/BackButton';
import styles from '../Settings.module.css';

export default function AdminFees() {
    const { activeLeague } = useLeague();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    
    const [duesAmount, setDuesAmount] = useState(100);
    const [enableTxnFees, setEnableTxnFees] = useState(false);
    const [txnFeeAmount, setTxnFeeAmount] = useState(1);
    const [excludeDefs, setExcludeDefs] = useState(false);
    const [ledger, setLedger] = useState({});
    const [rosters, setRosters] = useState([]);

    useEffect(() => {
        const loadData = async () => {
            if (!activeLeague?.id) return;
            setLoading(true);
            try {
                const { data: dbLeague } = await supabase
                    .from('leagues')
                    .select('dues_amount, enable_txn_fees, txn_fee_amount, exclude_defenses_from_fees, financial_ledger')
                    .eq('id', activeLeague.id)
                    .single();

                if (dbLeague) {
                    setDuesAmount(dbLeague.dues_amount ?? 100);
                    setEnableTxnFees(dbLeague.enable_txn_fees ?? false);
                    setTxnFeeAmount(dbLeague.txn_fee_amount ?? 1);
                    setExcludeDefs(dbLeague.exclude_defenses_from_fees ?? false);
                    setLedger(dbLeague.financial_ledger || {});
                }

                if (activeLeague.sleeper_league_id) {
                    const tmData = await getLeagueTeamManagers(activeLeague.sleeper_league_id);
                    const currentYearRosters = tmData?.teamManagersMap?.[tmData.currentSeason] || {};
                    const formatted = Object.entries(currentYearRosters).map(([rId, rData]) => ({
                        rosterId: rId,
                        teamName: rData.team?.name || `Team ${rId}`,
                        avatar: rData.team?.avatar || 'https://sleepercdn.com/images/v2/icons/player_default.webp'
                    }));
                    setRosters(formatted);
                }
            } catch (e) {
                console.error("Failed to load fees data", e);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [activeLeague]);

    const handleLedgerChange = (rosterId, amount) => {
        setLedger(prev => ({
            ...prev,
            [rosterId]: parseFloat(amount) || 0
        }));
    };

    const handleSave = async () => {
        if (!activeLeague?.id) return;
        setSaving(true);
        try {
            const { error } = await supabase
                .from('leagues')
                .update({
                    dues_amount: duesAmount,
                    enable_txn_fees: enableTxnFees,
                    txn_fee_amount: txnFeeAmount,
                    exclude_defenses_from_fees: excludeDefs,
                    financial_ledger: ledger
                })
                .eq('id', activeLeague.id);
            
            if (error) throw error;
            setMessage('Financial settings saved!');
            setTimeout(() => setMessage(''), 3000);
        } catch (err) {
            setMessage('Error saving financial settings.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className={styles.loading}>Loading Financials...</div>;

    return (
        <div className={styles.container}>
            <BackButton />
            <div className={styles.settingsCard}>
                <div className={styles.header}>
                    <i className="material-icons">payments</i>
                    <h1 className={styles.title}>League Financials</h1>
                </div>

                <div className={styles.settingsGrid}>
                    <div className={styles.infoGroup}>
                        <label>Base League Dues ($)</label>
                        <input 
                            type="number" 
                            className={styles.inputField} 
                            value={duesAmount} 
                            onChange={(e) => setDuesAmount(parseFloat(e.target.value) || 0)} 
                        />
                    </div>

                    <div className={styles.infoGroup}>
                        <label className={styles.checkboxLabel}>
                            <input 
                                type="checkbox" 
                                checked={enableTxnFees} 
                                onChange={(e) => setEnableTxnFees(e.target.checked)} 
                            />
                            Enable Transaction Fees
                        </label>
                    </div>

                    {enableTxnFees && (
                        <>
                            <div className={styles.infoGroup}>
                                <label>Fee Per Transaction ($)</label>
                                <input 
                                    type="number" 
                                    className={styles.inputField} 
                                    value={txnFeeAmount} 
                                    onChange={(e) => setTxnFeeAmount(parseFloat(e.target.value) || 0)} 
                                />
                            </div>
                            <div className={styles.infoGroup}>
                                <label className={styles.checkboxLabel}>
                                    <input 
                                        type="checkbox" 
                                        checked={excludeDefs} 
                                        onChange={(e) => setExcludeDefs(e.target.checked)} 
                                    />
                                    Exclude Defenses from Fees
                                </label>
                            </div>
                        </>
                    )}
                </div>

                <div className={styles.divider}></div>

                <h2 className={styles.subHeading}>Payment Ledger</h2>
                <p className={styles.helperText}>Enter the amount each franchise has paid toward their total balance.</p>

                <div className={styles.ledgerList}>
                    {rosters.map(r => (
                        <div key={r.rosterId} className={styles.ledgerRow}>
                            <div className={styles.ledgerTeam}>
                                <img src={r.avatar} alt="Team" className={styles.ledgerAvatar} />
                                <span>{r.teamName}</span>
                            </div>
                            <div className={styles.ledgerInputWrapper}>
                                <span className={styles.currencySymbol}>$</span>
                                <input 
                                    type="number" 
                                    className={styles.ledgerInput} 
                                    value={ledger[r.rosterId] || ''} 
                                    onChange={(e) => handleLedgerChange(r.rosterId, e.target.value)}
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                    ))}
                </div>

                {message && <div className={styles.message}>{message}</div>}
                
                <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Financials'}
                </button>
            </div>
        </div>
    );
}