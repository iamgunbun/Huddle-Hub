import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';
import styles from './SettingsModal.module.css';

export default function SettingsModal({ onClose }) {
    const navigate = useNavigate();
    const { activeLeague } = useLeague();
    
    const [ticketType, setTicketType] = useState('bug');
    const [ticketMessage, setTicketMessage] = useState('');
    const [status, setStatus] = useState(''); 

    const handleNavigation = (path) => {
        navigate(path);
        onClose();
    };

    const handleSubmitTicket = async (e) => {
        e.preventDefault();
        if (!ticketMessage.trim()) return;

        setStatus('submitting');

        try {
            const { data: sessionData } = await supabase.auth.getSession();
            const user = sessionData?.session?.user;

            const { error } = await supabase
                .from('support_tickets')
                .insert([
                    {
                        user_id: user?.id,
                        league_id: activeLeague?.id,
                        type: ticketType,
                        message: ticketMessage,
                        status: 'open'
                    }
                ]);

            if (error) throw error;

            setStatus('success');
            setTicketMessage('');
            setTimeout(() => setStatus(''), 3000);
        } catch (err) {
            console.error("Failed to submit ticket:", err);
            setStatus('error');
        }
    };

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                
                <div className={styles.modalHeader}>
                    <h2>Settings & Support</h2>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <i className="material-icons">close</i>
                    </button>
                </div>

                <div className={styles.settingsSection}>
                    <h3 className={styles.sectionTitle}>My Account</h3>
                    <button 
                        className={styles.navBtn}
                        onClick={() => handleNavigation('/account')}
                    >
                        <i className="material-icons">person</i> Edit Profile
                    </button>
                </div>

                {activeLeague?.is_commissioner && (
                    <div className={styles.settingsSection}>
                        <h3 className={styles.sectionTitle}>Commissioner Tools</h3>
                        <button className={styles.navBtn} onClick={() => handleNavigation('/admin/notes')}>
                            <i className="material-icons">edit_note</i> Edit Commish Note
                        </button>
                        <button className={styles.navBtn} onClick={() => handleNavigation('/admin/constitution')}>
                            <i className="material-icons">gavel</i> Amend Constitution
                        </button>
                        <button className={styles.navBtn} onClick={() => handleNavigation('/admin/fees')}>
                            <i className="material-icons">payments</i> Manage League Dues
                        </button>
                    </div>
                )}

                <div className={`${styles.settingsSection} ${styles.divider}`}>
                    <h3 className={styles.sectionTitle}>Submit a Ticket</h3>
                    <form onSubmit={handleSubmitTicket} className={styles.ticketForm}>
                        <select 
                            className={styles.dropdown}
                            value={ticketType} 
                            onChange={(e) => setTicketType(e.target.value)}
                        >
                            <option value="bug">Report a Bug</option>
                            <option value="question">General Question</option>
                            <option value="feature">Feature Request</option>
                        </select>
                        <textarea 
                            className={styles.textArea}
                            value={ticketMessage}
                            onChange={(e) => setTicketMessage(e.target.value)}
                            placeholder="Describe the issue or ask your question here..."
                            required
                        />
                        <button type="submit" className={styles.submitBtn} disabled={status === 'submitting'}>
                            {status === 'submitting' ? 'Sending...' : 'Submit Ticket'}
                        </button>
                        {status === 'success' && <div className={styles.successMsg}>Ticket submitted successfully!</div>}
                        {status === 'error' && <div className={styles.errorMsg}>Failed to submit. Please try again.</div>}
                    </form>
                </div>

            </div>
        </div>
    );
}