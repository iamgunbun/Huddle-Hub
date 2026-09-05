import React, { useState, useEffect } from 'react';
import { useLeague } from '../../context/LeagueContext';
import { updateLeagueSettings } from '../../utils/leagueAdmin';
import BackButton from '../../components/BackButton';
import styles from '../Settings.module.css';

export default function AdminNotes() {
    const { activeLeague } = useLeague();
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (activeLeague?.commish_note) {
            setNote(activeLeague.commish_note);
        }
    }, [activeLeague]);

    const handleSave = async () => {
        if (!activeLeague?.id) return;
        setSaving(true);
        const result = await updateLeagueSettings(activeLeague.id, { commish_note: note });
        setMessage(result.ok ? 'Note saved successfully!' : result.message);
        if (result.ok) setTimeout(() => setMessage(''), 3000);
        setSaving(false);
    };

    return (
        <div className={styles.container}>
            <BackButton />
            <div className={styles.settingsCard}>
                <div className={styles.header}>
                    <i className="material-icons">edit_note</i>
                    <h1 className={styles.title}>Commissioner's Note</h1>
                </div>
                <div className={styles.infoGroup}>
                    <label>Update Dashboard Message</label>
                    <textarea
                        className={styles.textArea}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Write a message to your league to be displayed on the home page..."
                        rows={6}
                    />
                </div>
                {message && <div className={styles.message}>{message}</div>}
                <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Note'}
                </button>
            </div>
        </div>
    );
}