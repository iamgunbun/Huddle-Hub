import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../../context/LeagueContext';
import { supabase } from '../../supabaseClient';
import styles from './AdminConstitution.module.css';

export default function AdminConstitution() {
    const { activeLeague, loadLeagueContext } = useLeague();
    const navigate = useNavigate();
    
    const [constitutionText, setConstitutionText] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);

    // Boot non-commissioners out of the Admin Dashboard
    useEffect(() => {
        if (activeLeague && !activeLeague.is_commissioner) {
            navigate('/');
        } else if (activeLeague) {
            setConstitutionText(activeLeague.constitution || '');
        }
    }, [activeLeague, navigate]);

    const handleSave = async () => {
        setIsSaving(true);
        setSaveMessage(null);

        try {
            const { error } = await supabase
                .from('leagues')
                .update({ constitution: constitutionText })
                .eq('id', activeLeague.id);

            if (error) throw error;

            setSaveMessage({ type: 'success', text: 'Constitution updated successfully.' });
            
            // Refresh league context to distribute the new constitution across the app
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                await loadLeagueContext(session.user.id, activeLeague.id);
            }
        } catch (error) {
            console.error("Error saving constitution:", error);
            setSaveMessage({ type: 'error', text: 'Failed to save. Please try again.' });
        } finally {
            setIsSaving(false);
            
            // Clear the success message after 3 seconds
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };

    if (!activeLeague) return null;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Admin Dashboard</h1>
                <h2 className={styles.subtitle}>Amend League Constitution</h2>
            </div>

            <div className={styles.editorCard}>
                <div className={styles.cardHeader}>
                    <i className="material-icons">gavel</i> Governing Rules & Bylaws
                </div>
                
                <div className={styles.editorBody}>
                    <p className={styles.instructions}>
                        Update the official rules, payout structures, and bylaws for <strong>{activeLeague.league_name}</strong> below. Changes will be immediately visible to all managers.
                    </p>
                    
                    <textarea 
                        className={styles.textArea}
                        value={constitutionText}
                        onChange={(e) => setConstitutionText(e.target.value)}
                        placeholder="Enter your league constitution here..."
                    />
                </div>

                <div className={styles.cardFooter}>
                    {saveMessage && (
                        <div className={`${styles.message} ${saveMessage.type === 'success' ? styles.success : styles.error}`}>
                            {saveMessage.text}
                        </div>
                    )}
                    <button 
                        className={styles.saveBtn} 
                        onClick={handleSave} 
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : 'Publish Amendments'}
                    </button>
                </div>
            </div>
        </div>
    );
}