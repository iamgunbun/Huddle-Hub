import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useLeague } from '../../context/LeagueContext';
import BackButton from '../../components/BackButton';
import styles from '../Settings.module.css';

export default function AdminConstitution() {
    const { activeLeague } = useLeague();
    const [constitution, setConstitution] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (activeLeague?.constitution) {
            setConstitution(activeLeague.constitution);
        }
    }, [activeLeague]);

    const handleSave = async () => {
        if (!activeLeague?.id) return;
        setSaving(true);
        try {
            const { error } = await supabase
                .from('leagues')
                .update({ constitution: constitution })
                .eq('id', activeLeague.id);
            if (error) throw error;
            setMessage('Constitution saved successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (err) {
            setMessage('Error saving constitution.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.container}>
            <BackButton />
            <div className={styles.settingsCard}>
                <div className={styles.header}>
                    <i className="material-icons">gavel</i>
                    <h1 className={styles.title}>League Constitution</h1>
                </div>
                <div className={styles.infoGroup}>
                    <label>Update League Rules & Bylaws</label>
                    <textarea
                        className={styles.textArea}
                        value={constitution}
                        onChange={(e) => setConstitution(e.target.value)}
                        placeholder="Paste your complete league rules here..."
                        rows={15}
                    />
                </div>
                {message && <div className={styles.message}>{message}</div>}
                <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Constitution'}
                </button>
            </div>
        </div>
    );
}