import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../../context/LeagueContext';
import { supabase } from '../../supabaseClient';
import styles from './AdminConstitution.module.css'; // Reusing the same layout styles for consistency

export default function AdminNotes() {
    const { activeLeague, loadLeagueContext } = useLeague();
    const navigate = useNavigate();
    
    const [noteText, setNoteText] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);

    useEffect(() => {
        if (activeLeague && !activeLeague.is_commissioner) {
            navigate('/');
        } else if (activeLeague) {
            setNoteText(activeLeague.commish_note || '');
        }
    }, [activeLeague, navigate]);

    const handleSave = async () => {
        setIsSaving(true);
        setSaveMessage(null);

        try {
            const { error } = await supabase
                .from('leagues')
                .update({ commish_note: noteText })
                .eq('id', activeLeague.id);

            if (error) throw error;

            setSaveMessage({ type: 'success', text: 'Commissioner note updated.' });
            
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                await loadLeagueContext(session.user.id, activeLeague.id);
            }
        } catch (error) {
            console.error("Error saving note:", error);
            setSaveMessage({ type: 'error', text: 'Failed to save. Please try again.' });
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(null), 3000);
        }
    };

    if (!activeLeague) return null;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Admin Dashboard</h1>
                <h2 className={styles.subtitle}>Edit Commissioner Note</h2>
            </div>

            <div className={styles.editorCard}>
                <div className={styles.cardHeader}>
                    <i className="material-icons">edit_note</i> League Announcement
                </div>
                
                <div className={styles.editorBody}>
                    <p className={styles.instructions}>
                        Broadcast a message to the entire league. This note will be pinned directly to the home dashboard.
                    </p>
                    
                    <textarea 
                        className={styles.textArea}
                        style={{ minHeight: '250px' }}
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Write your league announcement here..."
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
                        {isSaving ? 'Saving...' : 'Pin to Dashboard'}
                    </button>
                </div>
            </div>
        </div>
    );
}